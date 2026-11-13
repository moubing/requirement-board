import { useState } from '#app'
import { bingToast } from '@moubing/bing-ui'
import { useAccountAccessState } from './use-account-access-state'
import { createOperationFeedback } from '../utils/operation-feedback'

export function useOperationFeedback() {
  const access = useAccountAccessState()
  const epoch = useState('operation-account-epoch', () => 0)
  return createOperationFeedback(() => `${access.value?.user.id ?? ''}:${epoch.value}`, bingToast)
}
