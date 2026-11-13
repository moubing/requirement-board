import { Info, Lightbulb, TriangleAlert, OctagonAlert } from 'lucide-vue-next'
import { calloutTones, calloutToneDetails } from '~~/shared/editor/callout'

export const calloutIcons = { note: Info, tip: Lightbulb, warning: TriangleAlert, danger: OctagonAlert }
export const calloutOptions = calloutTones.map(tone => ({ tone, icon: calloutIcons[tone], ...calloutToneDetails[tone] }))
