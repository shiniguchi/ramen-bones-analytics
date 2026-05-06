# i18n Backlog: Event Strip + Popup (Phase 16.3 — de / es / fr)

**Created:** 2026-05-06
**Source phase:** 16.3-04
**Reason:** Per CONTEXT.md C-05 + 16.1-02 precedent, the friend-owner only verifies ja + en at 375×667. de / es / fr were seeded with en-verbatim placeholder values to keep the TypeScript `MessageKey` shape consistent.

## Keys to translate

| Key | EN source |
|-----|-----------|
| `event_type_campaign_start` | `Campaign` |
| `event_type_transit_strike` | `Transit strike` |
| `event_type_school_holiday` | `School holiday` |
| `event_type_holiday` | `Public holiday` |
| `event_type_recurring_event` | `Recurring event` |
| `popup_event_count` | `{n} events` |
| `popup_show_all_events` | `Show all {n}` |
| `popup_show_fewer` | `Show fewer` |
| `event_strip_open_popup` | `{count} events on {date}` |

## Translation guidance

- Match the existing tone of the locale (formal restaurant-owner persona, not engineer)
- Preserve `{n}`, `{date}`, `{count}` placeholders exactly
- Singular vs plural: en source already uses plural-only ("events"); if the target language requires plural inflection on `popup_event_count`, add a separate `_one` variant key in a follow-up commit (precedent: `popup_horizon_days_one` / `popup_horizon_days_many`)

## Status

- [ ] de translated
- [ ] es translated
- [ ] fr translated

Resolved when all 3 ticked AND messages.ts updated.
