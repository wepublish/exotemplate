import axios from 'axios'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()

  // Default configuration - overwrite these or set in runtime config/.env
  const jiraDomain = 'wepublish.atlassian.net'
  const email = config.jiraEmail
  const apiKey = config.jiraApiKey

  try {
    if (!email) {
      throw new Error('Email to access Jira is not configured!')
    }
    if (!apiKey) {
      throw new Error('API Key to access Jira is not configured!')
    }

    const jql = `key in (BA-92, BA-93, BA-94, BA-96)`

    const response = await axios.get(`https://${jiraDomain}/rest/api/3/search/jql`, {
      params: {
        jql,
        fields: 'summary, customfield_10028'
        
      },
      auth: {
        username: email,
        password: apiKey
      },
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    })

    return response.data
  } catch (error: any) {
    const errorMessage = error?.response?.data || error?.message || 'No error message provided in issues.ts'
    console.log(errorMessage)
    throw createError({
      statusCode: error.response?.status || 500,
      statusMessage: errorMessage,
      data: error.response?.data
    })
  }
})
