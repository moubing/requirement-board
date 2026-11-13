import { useCollaborationServer } from '../services/collaboration'

const connections = new Map<string, ReturnType<ReturnType<typeof useCollaborationServer>['handleConnection']>>()

export default defineWebSocketHandler({
  open(peer) {
    const connection = useCollaborationServer().handleConnection({
      get readyState() { return peer.websocket.readyState ?? 3 },
      send(data: string | Uint8Array) { peer.send(data) },
      close(code, reason) { peer.close(code, reason) },
    }, new Request(peer.request.url, { headers: peer.request.headers }))
    connections.set(peer.id, connection)
  },
  message(peer, message) { connections.get(peer.id)?.handleMessage(message.uint8Array()) },
  close(peer, event) {
    connections.get(peer.id)?.handleClose({ code: event.code ?? 1000, reason: event.reason ?? '' })
    connections.delete(peer.id)
  },
  error(peer) {
    connections.get(peer.id)?.handleClose()
    connections.delete(peer.id)
    peer.close(1011, '连接中断，请重新连接')
  },
})
