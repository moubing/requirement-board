import { closeCollaborationServer } from '../services/collaboration'

export default defineNitroPlugin(app => {
  app.hooks.hook('close', closeCollaborationServer)
})
