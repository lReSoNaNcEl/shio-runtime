import type { ShioCapabilitySnapshot } from '../../../shared/capabilities'
import { type TranslationKey, translate, type UiLocale } from '../../../shared/localization'

export const CAPABILITY_CONTEXT_UNAVAILABLE_PROMPT = [
  '## Current Shio Capabilities',
  'The current capability inventory is unavailable for this turn.',
  'Do not claim that any specific optional feature or capability is installed, enabled, or usable. Say that current availability cannot be verified.',
].join('\n\n')

const CAPABILITY_AVAILABILITY_KEY: Record<
  ShioCapabilitySnapshot['capabilities'][number]['availability'],
  TranslationKey
> = {
  available: 'capabilities.availability.available',
  disabled: 'capabilities.availability.disabled',
  'needs-setup': 'capabilities.availability.needsSetup',
  degraded: 'capabilities.availability.degraded',
  unavailable: 'capabilities.availability.unavailable',
}

function capabilityAuthorityLabel(
  authority: NonNullable<ShioCapabilitySnapshot['capabilities'][number]['authority']>,
  locale: UiLocale,
): string {
  const labels = {
    ru: {
      'read-only': 'только просмотр',
      confirm: 'действия только после подтверждения',
      full: 'действия в пределах выданных разрешений',
    },
    en: {
      'read-only': 'view only',
      confirm: 'actions require confirmation',
      full: 'actions within granted permissions',
    },
  } as const
  return labels[locale][authority]
}

export function characterCapabilityPrompt(
  context: ShioCapabilitySnapshot,
  locale: UiLocale,
): string {
  const capabilities = context.capabilities.map((capability) => {
    return [
      `- ${translate(locale, capability.titleKey)}: ${translate(locale, CAPABILITY_AVAILABILITY_KEY[capability.availability])}`,
      ...(capability.source.kind === 'plugin'
        ? [
            locale === 'ru'
              ? '  дополнительная возможность установлена'
              : '  optional feature is installed',
          ]
        : []),
      ...(capability.authority
        ? [
            `  ${locale === 'ru' ? 'доступ' : 'access'}: ${capabilityAuthorityLabel(capability.authority, locale)}`,
          ]
        : []),
      ...(capability.reasonKey ? [`  note: ${translate(locale, capability.reasonKey)}`] : []),
    ].join('\n')
  })
  return [
    '## Current Shio Capabilities',
    'These are current, request-scoped facts. Use only this list when answering what Shio can currently do.',
    'Available means usable now. Disabled means installed but switched off. Needs-setup means present but not ready. Degraded or unavailable must not be described as fully usable.',
    'Describe capabilities in user language. Do not mention package names, transports, storage engines, protocols, or internal component names unless the user explicitly asks about technical implementation.',
    'Knowing that a capability exists never by itself authorizes enabling, configuring, invoking, or executing it. Authority comes from the current user request and the capability’s current contract.',
    'Apply a confirmation step only when that capability contract requires one. Do not extend Action Runtime confirmation rules to internal Core operations whose contract permits direct execution.',
    capabilities.length > 0 ? capabilities.join('\n\n') : 'Current capabilities: none.',
  ].join('\n\n')
}
