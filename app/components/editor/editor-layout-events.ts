export const EDITOR_LAYOUT_MOTION_FRAME_EVENT = 'requirement-editor-layout-motion-frame'
export const EDITOR_ACTIVITY_CHANGE_EVENT = 'requirement-editor-activity-change'
/** 图片/表格尺寸交互的开始/结束；CustomEvent<boolean>，只协调光标显示，不写正文事务。 */
export const EDITOR_IMAGE_RESIZE_EVENT = 'requirement-editor-image-resize'
/** 阅读位置恢复写入正文 viewport 后派发；宽度锚点据此丢弃恢复前的旧位置。 */
export const EDITOR_READING_POSITION_RESTORED_EVENT = 'requirement-editor-reading-position-restored'
