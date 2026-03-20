import { defineOperationApp } from '@directus/extensions-sdk'

export default defineOperationApp({
  id: 'peering-articles',
  name: 'Peering Articles',
  icon: 'box',
  description:
    'Get and store all articles from within the we.publish media network.',
  overview: ({ text }) => [
    {
      label: 'Text',
      text: text
    }
  ],
  options: []
})
