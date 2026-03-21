import { ForbiddenError } from '@directus/errors'
import { defineOperationApi } from '@directus/extensions-sdk'
import { Client, PeerArticle } from '../DirectusTypes'
import { ItemsService } from '@directus/api/dist/services/items'

type Options = {
  text: string
}

interface WePublishArticle {
  id: string
  publishedAt: string
  slug: string
  url: string
  published: {
    title: string
    lead: string
    image: {
      url: string
    } | null
  } | null
  peerId: string | null
  blocks: {
    image: {
      url: string | null
    }
  }[]
}

export default defineOperationApi<Options>({
  id: 'peering-articles',
  handler: async ({ text }, { services, getSchema, accountability }) => {
    try {
      // 1. check access rights
      if (!accountability?.user) {
        return new ForbiddenError()
      }

      // 2. prepare some items services
      const { ItemsService } = services
      const clientsService = new ItemsService<Client>('Clients', {
        schema: await getSchema(),
        accountability
      })
      const peerArticleService = new ItemsService<PeerArticle>('PeerArticles', {
        schema: await getSchema(),
        accountability
      }) as ItemsService<PeerArticle>

      // 3. get list of media apis
      const clients = await clientsService.readByQuery({
        filter: {
          status: {
            _eq: 'published'
          }
        },
        fields: ['id', 'name', 'apiUrl'],
        limit: -1
      })

      // 4. get and store latest articles from each media
      for (const client of clients) {
        if (!client.apiUrl) continue

        let publicationDateFrom = new Date(
          new Date().setFullYear(new Date().getFullYear() - 1)
        )

        // get latest stored article by client
        const latestArticle = await getLatestArticleByClient(
          peerArticleService,
          client
        )

        if (!latestArticle?.source_publishedAt) {
          console.warn(
            `Client ${client.name} didn't have any latest articles scrapped.`
          )
        } else {
          publicationDateFrom = new Date(latestArticle.source_publishedAt)
          // workaround because directus cuts the milliseconds >> potential loss of articles
          publicationDateFrom.setSeconds(publicationDateFrom.getSeconds() + 1)
        }

        const articles = await getLatestArticlesByClient(
          client,
          publicationDateFrom
        )

        await saveLatestArticles(peerArticleService, client, articles)
      }
    } catch (e) {
      console.error(e)
    }
  }
})

async function saveLatestArticles(
  peerArticleService: ItemsService,
  client: Client,
  articles: WePublishArticle[]
): Promise<void> {
  const peerArticles: Partial<PeerArticle>[] = articles
    .filter((article) => !article.peerId)
    .map((article) => {
      return {
        client: client.id,
        source_id: article.id,
        source_slug: article.slug,
        source_url: article.url,
        source_publishedAt: new Date(article.publishedAt).toISOString(),
        source_title: article.published?.title,
        source_lead: article.published?.lead,
        source_imageUrl:
          article.published?.image?.url ||
          article?.blocks?.find((block) => !!block?.image?.url)?.image?.url ||
          null,
        status: 'published'
      }
    })

  const storedArticles = await peerArticleService.createMany(peerArticles)
  console.log(
    `Stored ${storedArticles.length} new articles from ${client.name}`
  )
}

async function getLatestArticleByClient(
  peerArticleService: ItemsService,
  client: Client
): Promise<PeerArticle | undefined> {
  const latestArticle = (await peerArticleService.readByQuery({
    sort: ['-source_publishedAt'],
    filter: {
      client: {
        _eq: client.id
      }
    },
    limit: 1
  })) as PeerArticle[]

  return latestArticle?.[0]
}

async function getLatestArticlesByClient(
  client: Pick<Client, 'id' | 'name' | 'apiUrl'>,
  filterFrom: Date
): Promise<WePublishArticle[]> {
  if (!client.apiUrl) {
    console.warn(`No apiUrl provided for client ${client.name}`)
    return []
  }

  const gql = `
    query Articles($filter: ArticleFilter, $order: SortOrder, $take: Int) {
      articles(filter: $filter, order: $order, take: $take) {
        nodes {
          id
					publishedAt
					slug
					url
					published {
						title
						lead
						image {
							url
						}
						blocks {
							... on ImageBlock {
								image {
									url
								}
							}
						}
					}
					peerId
        }
      }
    }
  `

  const variables = {
    filter: {
      publicationDateFrom: {
        date: filterFrom.toISOString(),
        comparison: 'GreaterThan'
      }
    },
    order: 'Ascending',
    take: 100
  }

  try {
    const response = await fetch(client.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({ query: gql, variables })
    })

    if (!response.ok) {
      console.error(
        `Status ${response.status} when fetching articles for ${client.name}`
      )
      return []
    }

    const result = await response.json()
    const articles: WePublishArticle[] = result.data?.articles?.nodes || []

    return articles
  } catch (error) {
    console.error(`Error fetching articles for ${client.name}:`, error)
    return []
  }
}
