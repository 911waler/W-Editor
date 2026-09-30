import type { AnnouncementState } from './adapter'

export interface PublicationInput {
  title: string
  level: 'normal' | 'important'
  sendEmail: boolean
  scheduledFor: string
  reminderEndsAt: string
}
export interface PublicationSettings extends PublicationInput {
  serverRevision: string
  state: AnnouncementState
  recipientCount: number
  missingCount: number
  mailLabel: string
}
