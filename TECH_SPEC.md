CONTENTOS AI

Полное техническое задание для разработки AI Content Automation SaaS через Codex

Версия: 1.0
Статус: Ready for Development
Тип продукта: Multi-tenant SaaS / AI Content Automation Platform
Рабочее название: ContentOS AI
Основной рынок MVP: B2B, эксперты, агентства, малый и средний бизнес
Основной язык MVP: русский
Архитектура: multi-tenant, provider-agnostic, asynchronous, API-first

---

1. ЦЕЛЬ ПРОЕКТА

Разработать SaaS-платформу, которая заменяет значительную часть работы контент-отдела.

Система должна помогать пользователю пройти полный путь:

Бизнес
↓
Анализ
↓
Стратегия
↓
Целевая аудитория
↓
Контентные направления
↓
Идеи
↓
Контент-план
↓
Сценарии
↓
AI-аватар
↓
Видео
↓
Субтитры / монтаж / B-roll
↓
Обложка
↓
Одобрение
↓
Публикация
↓
Аналитика
↓
AI-рекомендации
↓
Оптимизированная стратегия

Продукт должен быть оригинальным и не должен копировать:

- исходный код KOINET;
- дизайн KOINET;
- тексты KOINET;
- брендинг KOINET;
- закрытые API;
- proprietary assets.

Допускается создание продукта того же функционального класса.

---

2. ГЛАВНОЕ ЦЕННОСТНОЕ ПРЕДЛОЖЕНИЕ

Пользователь подключает компанию один раз.

ContentOS AI запоминает:

- что продаёт компания;
- кому продаёт;
- конкурентные преимущества;
- позиционирование;
- целевую аудиторию;
- боли аудитории;
- возражения;
- tone of voice;
- запрещённые формулировки;
- CTA;
- продукты;
- офферы;
- успешный и неуспешный контент.

После этого пользователь может создавать контент без повторного объяснения контекста бизнеса.

Основной принцип:

«Один раз обучить ContentOS бизнесу — затем использовать его как постоянный AI-контент-отдел.»

---

3. ОСНОВНЫЕ ЦЕЛЕВЫЕ СЕГМЕНТЫ

3.1 Эксперт

Один личный бренд.

Нужно:

- идеи;
- сценарии;
- talking-head видео;
- Reels / Shorts;
- публикации.

---

3.2 Малый бизнес

Например:

- клиника;
- салон красоты;
- недвижимость;
- юристы;
- образование;
- автосервис;
- маркетинговое агентство.

Нужно:

- системный контент;
- привлечение лидов;
- минимум участия сотрудников.

---

3.3 Контент-агентство

Управляет 10–100 клиентами.

Нужно:

- multi-client workspace;
- роли менеджеров;
- approvals клиентов;
- массовое создание контента;
- аналитика;
- cost control.

---

4. ГРАНИЦЫ MVP

MVP считается успешным, если пользователь реально может пройти:

Регистрация
→ организация
→ бренд
→ onboarding
→ Brand Brain
→ стратегия
→ идеи
→ сценарий
→ AI-аватар
→ генерация видео
→ субтитры
→ готовый MP4
→ approval
→ публикация минимум в 1–2 поддерживаемые платформы
→ статистика
→ AI-анализ

MVP НЕ должен превращаться в fake-demo.

Любая кнопка, объявленная рабочей, должна иметь работающий backend.

---

5. ФУНКЦИОНАЛЬНЫЕ МОДУЛИ

Система состоит минимум из:

1. Authentication
2. Organizations
3. Workspaces
4. Brands
5. Brand Brain
6. AI Strategy
7. Audience Analysis
8. Competitor Analysis
9. Ideas
10. Content Calendar
11. Script Studio
12. Avatar Studio
13. Voice Studio
14. Video Factory
15. Subtitle Studio
16. B-roll
17. Cover Studio
18. Approval System
19. Social Integrations
20. Publishing
21. Analytics
22. AI Performance Analyst
23. Comment Inbox
24. Notifications
25. Subscription
26. Usage Billing
27. Payments
28. Team Management
29. Agency Mode
30. Admin Panel
31. Audit Log
32. Privacy Center.

---

6. АРХИТЕКТУРА

Высокоуровневая схема:

                    USERS
                      │
                      ▼
               ┌───────────────┐
               │   Next.js UI  │
               └───────┬───────┘
                       │
                       ▼
               ┌───────────────┐
               │   API / BFF   │
               └───────┬───────┘
                       │
        ┌──────────────┼────────────────┐
        │              │                │
        ▼              ▼                ▼
   PostgreSQL        Redis           Storage
        │              │                │
        │              ▼                │
        │           BullMQ              │
        │              │                │
        │              ▼                │
        │          AI Workers           │
        │              │                │
        └──────────────┼────────────────┘
                       │
              Provider Layer
                       │
      ┌────────────────┼──────────────────┐
      │                │                  │
      ▼                ▼                  ▼
     LLM             HeyGen           Social APIs
                                         │
                    ┌────────────────────┼─────────┐
                    ▼                    ▼         ▼
                 TikTok               YouTube   Telegram

---

7. ОСНОВНОЙ СТЕК

Frontend

- Next.js
- React
- TypeScript strict
- App Router
- Tailwind CSS
- shadcn/ui

Использовать современные Server Components там, где это разумно.

Client Components использовать только при необходимости клиентской интерактивности.

---

Backend

- Node.js
- TypeScript
- Next.js Route Handlers для BFF/API
- отдельный Worker application.

Не выполнять долгие AI/video операции внутри HTTP request.

---

Database

PostgreSQL.

ORM:

Drizzle ORM.

---

Queue

Redis.

BullMQ.

---

Media

FFmpeg.

---

Storage

S3-compatible Object Storage.

Абстракция:

interface StorageProvider {
  upload(...)
  delete(...)
  getSignedUrl(...)
  copy(...)
  exists(...)
}

---

Monorepo

pnpm + Turborepo.

---

8. СТРУКТУРА РЕПОЗИТОРИЯ

/
├── apps
│   ├── web
│   │   ├── app
│   │   ├── components
│   │   ├── features
│   │   ├── lib
│   │   └── public
│   │
│   └── worker
│       ├── src
│       │   ├── jobs
│       │   ├── processors
│       │   └── workers
│       └── package.json
│
├── packages
│   ├── ai
│   │   ├── prompts
│   │   ├── schemas
│   │   ├── workflows
│   │   └── orchestration
│   │
│   ├── core
│   │   ├── domain
│   │   ├── services
│   │   └── errors
│   │
│   ├── db
│   │   ├── schema
│   │   ├── migrations
│   │   ├── repositories
│   │   └── seed
│   │
│   ├── providers
│   │   ├── llm
│   │   ├── avatar
│   │   ├── video
│   │   ├── social
│   │   ├── payment
│   │   ├── storage
│   │   └── analytics
│   │
│   ├── queue
│   ├── config
│   ├── types
│   ├── security
│   ├── observability
│   └── ui
│
├── docs
│   ├── ARCHITECTURE.md
│   ├── DATA_MODEL.md
│   ├── SECURITY.md
│   ├── PROVIDERS.md
│   ├── BILLING.md
│   ├── DEPLOYMENT.md
│   └── RUNBOOK.md
│
├── .github
│   └── workflows
│
├── docker-compose.yml
├── AGENTS.md
├── TECH_SPEC.md
├── README.md
├── turbo.json
├── pnpm-workspace.yaml
└── package.json

---

9. AGENTS.MD

Codex обязан создать "AGENTS.md".

В нём закрепить:

- TypeScript strict mode;
- обязательную Zod validation;
- запрет secrets в Git;
- запрет direct DB access из React UI;
- запрет direct provider calls из UI;
- provider abstraction;
- tenant isolation;
- idempotency;
- migrations policy;
- testing policy;
- security policy;
- logging policy;
- async job rules;
- branch/commit conventions.

Главное правило:

UI → API → Domain Service → Repository / Provider

Не:

UI → HeyGen
UI → PostgreSQL
UI → YooKassa

---

10. MULTI-TENANCY

Иерархия:

User
│
▼
Organization
│
├── Members
│
▼
Workspace
│
▼
Brand

Пример:

Digital Agency
├── Brand: Clinic
├── Brand: Realtor
├── Brand: Restaurant
└── Brand: FINDRIVE

---

11. RBAC

Роли:

OWNER
ADMIN
MANAGER
EDITOR
CLIENT_APPROVER
VIEWER

OWNER

Полный контроль.

ADMIN

Управление командой и брендами.

MANAGER

Создание и публикация контента.

EDITOR

Контент без управления billing.

CLIENT_APPROVER

Просмотр и approval.

VIEWER

Read only.

Все permissions должны проверяться на backend.

Нельзя полагаться на скрытие UI-кнопки.

---

12. AUTHENTICATION

Поддержать:

- email/password;
- email verification;
- password reset;
- secure sessions;
- OAuth-ready provider architecture.

Cookies:

- HttpOnly;
- Secure production;
- SameSite.

Обязательно:

- login throttling;
- rate limiting;
- session invalidation;
- password hashing;
- compromised session revocation.

---

13. ONBOARDING

Wizard с автосохранением.

Шаг 1

Компания.

Поля:

- название;
- сайт;
- страна;
- регион;
- язык.

Шаг 2

Продукты и услуги.

Шаг 3

Описание бизнеса.

Шаг 4

Целевая аудитория.

Шаг 5

Проблемы клиентов.

Шаг 6

Конкуренты.

Шаг 7

Преимущества.

Шаг 8

Tone of voice.

Шаг 9

Цели:

- awareness;
- followers;
- engagement;
- leads;
- sales;
- authority.

Шаг 10

Социальные сети.

Шаг 11

CTA.

Шаг 12

Референсный контент.

После завершения создать Brand Brain.

---

14. BRAND BRAIN

Brand Brain является фундаментом платформы.

Нельзя реализовывать его только строкой:

"Вот информация о компании..."

Source of truth — структурированные сущности.

---

15. DATA MODEL

Все ID:

UUID.

Все timestamps:

UTC.

Основные поля практически всех tenant entities:

id
organization_id
workspace_id
brand_id
created_at
updated_at
created_by

где применимо.

---

16. USERS

users

id
email
email_normalized
password_hash
first_name
last_name
avatar_url
locale
timezone
status
email_verified_at
created_at
updated_at
last_login_at

Status:

ACTIVE
SUSPENDED
DELETED

---

17. ORGANIZATIONS

organizations

id
name
slug
owner_user_id
default_timezone
default_locale
status
created_at
updated_at

---

18. ORGANIZATION_MEMBERS

organization_members

id
organization_id
user_id
role
status
invited_by
joined_at
created_at

Unique:

organization_id + user_id

---

19. WORKSPACES

workspaces

id
organization_id
name
type
created_at
updated_at

Type:

DEFAULT
AGENCY
CLIENT

---

20. BRANDS

brands

id
workspace_id
name
slug
description
website_url
industry
country
language
timezone
logo_asset_id
status
created_at
updated_at

---

21. PRODUCTS

products

id
brand_id
name
description
category
price_from
price_to
currency
url
is_active
created_at
updated_at

---

22. AUDIENCE SEGMENTS

audience_segments

id
brand_id
name
description
demographics_json
psychographics_json
priority
created_at
updated_at

---

23. PAIN POINTS

pain_points

id
brand_id
audience_segment_id
title
description
severity
created_at

---

24. DESIRES

desires

id
brand_id
audience_segment_id
title
description
priority

---

25. OBJECTIONS

objections

id
brand_id
audience_segment_id
title
response_strategy
priority

---

26. COMPETITORS

competitors

id
brand_id
name
website_url
social_urls_json
strengths_json
weaknesses_json
positioning
notes
created_at

---

27. BRAND VOICE

brand_voice

id
brand_id
tone
style
preferred_words_json
forbidden_words_json
preferred_phrases_json
forbidden_claims_json
examples_json
updated_at

---

28. CONTENT PILLARS

content_pillars

id
brand_id
name
description
percentage_target
funnel_stage
status

Например:

Экспертный — 30%
Образовательный — 25%
Продающий — 20%
Кейсы — 15%
Личный — 10%

---

29. OFFERS

offers

id
brand_id
product_id
name
headline
description
benefit
deadline
is_active

---

30. CTA

ctas

id
brand_id
name
type
text
target_url
utm_template
is_active

Types:

URL
DM
TELEGRAM
FORM
CALL
COMMENT
FOLLOW
SAVE
SHARE

---

31. STRATEGIES

strategies

id
brand_id
name
current_version_id
status
created_at
updated_at

---

32. STRATEGY VERSIONS

strategy_versions

id
strategy_id
version
content_json
generated_by
model
prompt_version
created_at

Стратегию никогда не перезаписывать.

Только новая версия.

---

33. IDEA MODEL

ideas

id
brand_id
title
description
angle
hook
audience_segment_id
content_pillar_id
platform
content_format
funnel_stage
goal
source
score_relevance
score_novelty
score_brand_fit
score_conversion
score_virality
status
created_at

Statuses:

DRAFT
SHORTLISTED
APPROVED
REJECTED
USED
ARCHIVED

---

34. CONTENT ITEM

Универсальная сущность контента.

content_items

id
brand_id
idea_id
type
title
status
scheduled_at
published_at
created_by
created_at
updated_at

Types:

SHORT_VIDEO
LONG_VIDEO
POST
CAROUSEL
IMAGE
STORY

---

35. CONTENT STATUS

IDEA
SCRIPTING
SCRIPT_READY
SCRIPT_APPROVED
GENERATING
MEDIA_READY
WAITING_APPROVAL
APPROVED
SCHEDULED
PUBLISHING
PUBLISHED
FAILED
ARCHIVED

---

36. SCRIPTS

scripts

id
content_item_id
current_version_id
target_duration
platform
status
created_at
updated_at

---

37. SCRIPT VERSION

script_versions

id
script_id
version
hook
context
body
proof
cta
full_text
estimated_duration
model
prompt_version
created_by
created_at

---

38. SCRIPT STUDIO

Функции:

- Generate
- Regenerate
- Rewrite
- Shorten
- Expand
- Simplify
- More Expert
- More Emotional
- More Provocative
- More Sales-Oriented
- Change Hook
- Change CTA
- Change Audience
- Change Duration.

Пользователь должен иметь возможность редактировать текст вручную.

---

39. AI PROVIDER ABSTRACTION

Нельзя привязывать систему напрямую к одной модели.

Интерфейс:

interface LLMProvider {
  generateText(input: GenerateTextInput): Promise<GenerateTextResult>
  generateStructured<T>(
    input: StructuredInput<T>
  ): Promise<StructuredResult<T>>
}

Дополнительно:

ImageProvider
AvatarProvider
VoiceProvider
VideoProvider
TranscriptionProvider
CaptionProvider
TrendProvider
PublishingProvider
AnalyticsProvider
PaymentProvider
StorageProvider

---

40. AI ORCHESTRATOR

AI Orchestrator отвечает за:

- выбор provider;
- выбор модели;
- prompt;
- retries;
- fallback;
- timeout;
- JSON validation;
- usage;
- cost;
- logging;
- correlation ID.

---

41. STRUCTURED OUTPUT

Любой результат AI, используемый программой, валидировать через Zod.

Пример:

const IdeaSchema = z.object({
  title: z.string(),
  hook: z.string(),
  angle: z.string(),
  reason: z.string(),
  contentPillar: z.string(),
  funnelStage: z.enum([
    "AWARENESS",
    "CONSIDERATION",
    "CONVERSION"
  ])
})

При invalid response:

validation error
→ repair attempt
→ retry
→ fallback provider
→ failed job

---

42. AI WORKFLOWS

Создать:

BrandAnalyst
AudienceAnalyst
CompetitorAnalyst
Strategist
ContentPillarGenerator
IdeaGenerator
HookGenerator
Scriptwriter
ContentEditor
BrandGuardian
FactChecker
VideoDirector
PublishingAssistant
PerformanceAnalyst
StrategyOptimizer

Это преимущественно workflow, а не бесконтрольно автономные агенты.

---

43. BRAND GUARDIAN

Перед approval контента проверить:

- tone of voice;
- запрещённые темы;
- запрещённые слова;
- сомнительные обещания;
- соответствие продукту;
- CTA;
- brand consistency.

Ответ:

{
  "passed": true,
  "score": 93,
  "issues": [],
  "suggestions": []
}

---

44. FACT CHECK

Создать отдельный интерфейс FactChecker.

При утверждениях типа:

"№1 в России"
"лечит..."
"гарантированно получите..."
"рост на 500%"

контент должен получать warning.

AI не должен самостоятельно считать маркетинговое утверждение доказанным.

---

45. CONTENT CALENDAR

Views:

- Day;
- Week;
- Month.

Функции:

- drag-and-drop;
- фильтр по платформе;
- фильтр по бренду;
- фильтр по статусу;
- массовое планирование;
- opening content editor.

---

46. AVATAR ENTITY

avatars

id
brand_id
name
provider
external_avatar_id
type
status
preview_asset_id
created_by
created_at
deleted_at

Types:

STOCK
CUSTOM
DIGITAL_TWIN

---

47. AVATAR LOOKS

avatar_looks

id
avatar_id
name
provider
external_look_id
preview_asset_id
status

---

48. VOICES

voices

id
brand_id
name
provider
external_voice_id
language
type
status
created_at

---

49. CONSENT

Создать:

consent_records

Поля:

id
organization_id
brand_id
user_id
subject_name
subject_type
consent_type
consent_version
consent_text_hash
accepted_at
revoked_at
ip_address
user_agent
metadata_json

Consent type:

OWN_LIKENESS
THIRD_PARTY_LIKENESS
VOICE_CLONING
EXTERNAL_AI_PROCESSING
AUTOMATED_PUBLISHING
MARKETING

Без нужного consent нельзя запускать соответствующий job.

---

50. HEYGEN PROVIDER

Первый Avatar/Video Provider:

HeyGenProvider

Он должен инкапсулировать:

- authentication;
- avatars;
- voices;
- generation;
- job status;
- webhook handling;
- provider errors.

Никогда не использовать HeyGen-specific IDs как primary domain IDs.

Хранить:

internal_id
provider
external_id
provider_metadata

Перед реализацией Codex обязан проверить актуальную официальную документацию HeyGen.

Не угадывать endpoints.

---

51. VIDEO PROJECT

video_projects

id
brand_id
content_item_id
script_version_id
avatar_id
voice_id
aspect_ratio
target_duration
resolution
status
progress
final_asset_id
created_at
updated_at

---

52. VIDEO STATE MACHINE

DRAFT
↓
QUEUED
↓
VOICE_PREPARING
↓
AVATAR_RENDERING
↓
SOURCE_READY
↓
POST_PROCESSING
↓
CAPTIONS
↓
BROLL
↓
FINAL_RENDER
↓
QC
↓
READY

Ошибка:

FAILED

Retry:

FAILED
↓
RETRYING

---

53. VIDEO FORMATS

Минимально:

9:16
1:1
16:9

Presets:

TikTok
Instagram Reels
YouTube Shorts
YouTube
Telegram
Universal Vertical

---

54. MEDIA ASSETS

media_assets

id
brand_id
type
storage_provider
bucket
object_key
mime_type
file_size
width
height
duration
checksum
status
created_at
deleted_at

Types:

IMAGE
VIDEO
AUDIO
SUBTITLE
COVER
DOCUMENT

Не хранить permanent public URL.

Использовать signed URLs.

---

55. VIDEO POST-PROCESSING

FFmpeg worker.

Pipeline:

download source
↓
validate
↓
normalize
↓
scale
↓
crop/pad
↓
audio normalization
↓
captions
↓
B-roll
↓
background music
↓
intro/outro optional
↓
encode
↓
upload
↓
QC

---

56. SUBTITLES

Хранить не только готовый ".srt".

Модель:

caption_tracks
caption_segments

Segment:

id
track_id
start_ms
end_ms
text
position
style_json

Пользователь может редактировать текст до render.

---

57. B-ROLL

B-roll должен быть отдельной сущностью.

broll_segments

id
video_project_id
start_ms
end_ms
prompt
asset_id
source
approved

Sources:

USER_MEDIA
AI_IMAGE
AI_VIDEO
STOCK

---

58. COVER STUDIO

Обложка:

- frame;
- background;
- headline;
- subtitle;
- layout;
- logo;
- fonts;
- brand palette.

Template system:

cover_templates

Не hardcode стили непосредственно в React components.

---

59. APPROVALS

approval_requests

id
entity_type
entity_id
requested_by
requested_from
status
comment
created_at
resolved_at

Statuses:

PENDING
APPROVED
REJECTED
CHANGES_REQUESTED
CANCELLED

---

60. PUBLISHING MODES

MANUAL
APPROVAL
AUTOPILOT

Default:

APPROVAL

AUTOPILOT нельзя включить случайно.

Требуется отдельное действие пользователя.

---

61. SOCIAL CONNECTION

social_connections

id
brand_id
provider
external_account_id
account_name
encrypted_access_token
encrypted_refresh_token
token_expires_at
scopes_json
status
metadata_json
created_at
updated_at

Statuses:

PENDING
CONNECTED
LIMITED
ACTIVE
TOKEN_EXPIRED
REVOKED
ERROR
REVIEW_REQUIRED

---

62. SOCIAL PROVIDER INTERFACE

interface SocialProvider {
  connect(...)
  refreshToken(...)
  validateConnection(...)

  getCapabilities(...)

  publishVideo(...)
  publishImage(...)
  publishText(...)

  getPublicationStatus(...)
  getMetrics(...)
  getComments(...)
  replyToComment(...)
}

Capabilities могут различаться.

Нельзя считать, что TikTok и Telegram имеют одинаковые возможности.

---

63. SOCIAL PROVIDERS

Архитектурно предусмотреть:

TikTokProvider
YouTubeProvider
InstagramProvider
VKProvider
TelegramProvider

Первыми в MVP можно реализовать:

Telegram
YouTube

или платформы, где production access реально получен.

TikTok интеграцию реализовать технически, но показывать её capability/status согласно фактическому approval API-приложения.

---

64. TIKTOK

Codex обязан использовать текущую официальную Content Posting API.

Не обходить ограничения через browser automation, cookies или пользовательские пароли.

Учитывать:

- OAuth;
- scopes;
- creator info;
- privacy options;
- upload;
- publish status;
- rate limits;
- application audit;
- AI-generated content flag там, где API его предусматривает.

Provider должен сообщать UI реальный capability.

Например:

DIRECT_PUBLIC_POST
DIRECT_PRIVATE_POST
UPLOAD_DRAFT
NOT_AVAILABLE

---

65. YOUTUBE

Использовать официальный YouTube Data API.

OAuth credentials только server-side.

Поддержать:

- upload;
- title;
- description;
- privacy;
- status;
- thumbnail;
- analytics abstraction.

Учитывать audit/verification requirements Google.

---

66. TELEGRAM

MVP integration:

Bot API.

Пользователь:

1. создаёт bot;
2. добавляет его администратором в канал;
3. предоставляет token;
4. указывает channel ID.

Token хранить encrypted.

Поддержать:

- text;
- image;
- video;
- caption.

---

67. INSTAGRAM / META

Архитектуру реализовать через официальный Meta API.

Не использовать:

- scraping;
- cookie stealing;
- password automation;
- headless login.

Если production permissions ещё не получены:

CONFIGURATION_REQUIRED

а не fake success.

---

68. VK

Реализовать только через разрешённые API-интеграции.

Provider abstraction должна позволять подключить API позднее без изменения ContentItem.

---

69. PUBLICATION ENTITY

publications

id
content_item_id
social_connection_id
provider
external_post_id
status
scheduled_at
published_at
permalink
provider_response_json
created_at
updated_at

Status:

PENDING
QUEUED
UPLOADING
PROCESSING
PUBLISHED
FAILED
CANCELLED

---

70. PUBLISHING JOB

Каждая публикация должна быть idempotent.

Idempotency key:

content_item_id
+
social_connection_id
+
scheduled_revision

Повтор worker job не должен создавать вторую публикацию.

---

71. SCHEDULER

Пользователь задаёт:

- platform;
- date;
- time;
- timezone;
- caption;
- hashtags;
- cover;
- comments;
- privacy.

В БД:

UTC.

В UI:

workspace timezone.

---

72. ASYNC JOB ENGINE

BullMQ queues:

ai
media
avatar
video
publishing
analytics
billing
notifications
maintenance

---

73. JOB TABLE

jobs

id
organization_id
brand_id
type
queue
status
progress
attempt
max_attempts
provider
external_job_id
idempotency_key
payload_json
result_json
error_code
error_message
correlation_id
created_at
started_at
finished_at

Statuses:

PENDING
QUEUED
RUNNING
WAITING_PROVIDER
SUCCESS
FAILED
CANCELLED
RETRYING

---

74. RETRIES

Transient provider error:

retry

Permanent validation error:

fail

Использовать exponential backoff + jitter.

Например:

30 sec
2 min
10 min
30 min

Конкретную стратегию сделать configurable.

---

75. WEBHOOKS

Endpoints:

POST /api/webhooks/heygen
POST /api/webhooks/yookassa
POST /api/webhooks/tiktok
POST /api/webhooks/...

Сначала сохранить событие.

Таблица:

webhook_events

id
provider
external_event_id
event_type
payload_json
signature_valid
status
received_at
processed_at

Unique:

provider + external_event_id

---

76. WEBHOOK IDEMPOTENCY

Flow:

receive
↓
verify
↓
insert event
↓
unique conflict?
   ↓ yes
return 2xx
↓ no
process
↓
mark processed

---

77. ANALYTICS

Normalized metrics:

views
impressions
reach
likes
comments
shares
saves
clicks
watch_time
average_watch_time
completion_rate
followers_delta

---

78. PUBLICATION METRICS

publication_metrics

id
publication_id
metric
value
measured_at
source

Также разрешить:

raw_metrics_json

для provider-specific данных.

---

79. PERFORMANCE ANALYST

AI должен анализировать:

- лучшие темы;
- худшие темы;
- hooks;
- CTA;
- длительность;
- формат;
- время публикации;
- контентные pillars;
- conversion hypothesis.

Результат:

performance_reports
strategy_recommendations

---

80. STRATEGY RECOMMENDATIONS

strategy_recommendations

id
strategy_id
type
title
reason
evidence_json
recommended_change_json
status
created_at

Status:

PENDING
ACCEPTED
REJECTED

AI не должен менять Brand Brain без approval пользователя.

---

81. COMMENT INBOX

comments

id
publication_id
provider
external_comment_id
external_author_id
author_name
text
sentiment
status
created_at

---

82. COMMENT MODES

SUGGEST_ONLY
APPROVAL
AUTO_REPLY

Default:

SUGGEST_ONLY

---

83. AUTO-REPLY SAFETY

Не отвечать автоматически на:

- юридические претензии;
- медицинские вопросы;
- финансовые обещания;
- угрозы;
- жалобы;
- запрос персональных данных;
- чувствительную информацию.

Такие комментарии:

NEEDS_HUMAN

---

84. BILLING

Plan entities:

plans
subscriptions
subscription_events
payments
payment_methods
usage_ledger

---

85. PLANS

Пример:

FREE
START
CREATOR
EXPERT
AGENCY

Цена и лимиты только в БД/config.

Нельзя писать:

if(plan === "EXPERT") return 16990

в UI.

---

86. PLAN LIMITS

Каждый plan содержит capabilities:

{
  "brands": 1,
  "teamMembers": 1,
  "aiCredits": 10000,
  "videoSeconds": 600,
  "socialAccounts": 3,
  "autopilot": false,
  "analyticsAI": true
}

---

87. USAGE LEDGER

Критически важная часть.

usage_ledger

id
organization_id
subscription_id
resource_type
transaction_type
amount
job_id
reference_id
metadata_json
created_at

Resource:

AI_CREDITS
VIDEO_SECONDS
STORAGE_BYTES

Transaction:

GRANT
PURCHASE
RESERVE
CAPTURE
RELEASE
REFUND
ADJUSTMENT
EXPIRE

Ledger immutable.

Нельзя удалять финансовые usage events.

---

88. RESERVE / CAPTURE

Перед video generation:

100 video seconds available
↓
reserve 30
↓
70 available
30 reserved

Generation success:

CAPTURE 30

Generation error:

RELEASE 30

Пользователь не должен платить за failed provider operation.

---

89. PAYMENT PROVIDER

interface PaymentProvider {
  createPayment(...)
  createRecurringPayment(...)
  refund(...)
  getPayment(...)
  handleWebhook(...)
}

Первый:

YooKassaProvider

Архитектурно:

StripeProvider

можно добавить позже.

---

90. YOOKASSA

Использовать официальный API.

Обязательно:

- Idempotence-Key;
- server-side credentials;
- payment status via webhook;
- повторная server-side проверка;
- support recurring payments только после требуемого согласия пользователя.

Не принимать redirect на success page как доказательство оплаты.

Source of truth:

provider payment status

---

91. SUBSCRIPTION STATE

TRIALING
ACTIVE
PAST_DUE
CANCEL_AT_PERIOD_END
CANCELLED
EXPIRED

---

92. AGENCY MODE

Организация типа агентство получает:

Clients
Client Brands
Managers
Client Approvers
Shared Templates
Usage per Client
Cost per Client

---

93. CLIENT APPROVAL PORTAL

Клиент должен иметь простой экран:

Ждут согласования: 5

Он может:

APPROVE
REQUEST CHANGES
REJECT
COMMENT

Без доступа к техническим настройкам агентства.

---

94. NOTIFICATIONS

Types:

SCRIPT_READY
APPROVAL_REQUIRED
VIDEO_READY
VIDEO_FAILED
PUBLICATION_SUCCESS
PUBLICATION_FAILED
TOKEN_EXPIRED
PAYMENT_SUCCESS
PAYMENT_FAILED
LIMIT_WARNING
SUBSCRIPTION_EXPIRING

Channels:

IN_APP
EMAIL
TELEGRAM

Telegram notifications можно добавить после MVP.

---

95. ADMIN PANEL

Только отдельная admin permission.

Разделы:

Overview
Users
Organizations
Brands
Subscriptions
Payments
Usage
Jobs
Failed Jobs
Providers
Webhook Events
Feature Flags
Costs
Audit Log

---

96. PROVIDER COSTS

Таблица:

provider_usage

id
job_id
provider
model
operation
input_units
output_units
video_seconds
provider_cost
currency
duration_ms
created_at

---

97. UNIT ECONOMICS DASHBOARD

Admin показывает:

MRR
Revenue
AI costs
Video costs
Storage costs
Gross margin
Cost / user
Cost / generated video
Cost / organization

---

98. AUDIT LOG

audit_logs

id
organization_id
user_id
action
entity_type
entity_id
before_json
after_json
ip_address
user_agent
created_at

Audit:

- role change;
- billing action;
- deleting avatar;
- enabling autopilot;
- social account connect/disconnect;
- consent;
- admin action.

---

99. FEATURE FLAGS

feature_flags

avatar_generation
video_generation
trend_radar
instagram_publishing
tiktok_publishing
youtube_publishing
telegram_publishing
autopilot
comments
analytics_ai
agency_mode
byok

Можно назначать по:

GLOBAL
PLAN
ORGANIZATION
USER

---

100. BYOK

Для Expert / Agency предусмотреть:

Bring Your Own Key

Например пользователь подключает собственный:

HeyGen
LLM provider

Secret:

- encrypted;
- server side;
- never returned back;
- masked in UI.

Например:

••••••••73Hd

---

101. SECURITY

Следовать OWASP.

Особое внимание:

- Broken Access Control
- Injection
- Authentication
- Secrets
- SSRF
- Webhooks
- Uploads
- OAuth.

---

102. TENANT ISOLATION

Это критический security requirement.

Любой repository method должен получать tenant context.

Плохо:

getBrand(id)

Лучше:

getBrand({
  organizationId,
  brandId
})

Нельзя получить чужой Brand по UUID.

---

103. FILE UPLOAD SECURITY

Проверять:

- size;
- MIME;
- file signature;
- extension;
- dimensions;
- duration.

Нельзя доверять:

Content-Type

от клиента.

---

104. SSRF

Provider, B-roll и URL imports могут стать SSRF-вектором.

Запретить загрузку:

localhost
127.0.0.1
10.x.x.x
172.16.x.x
192.168.x.x
metadata endpoints

если функция импортирует пользовательский URL.

---

105. SECRETS

Никогда не логировать:

API keys
OAuth tokens
Refresh tokens
Passwords
Card credentials
Webhook secrets

---

106. PRIVACY CENTER

Пользователь может:

- экспортировать данные;
- отключить соцсеть;
- удалить аватар;
- удалить voice;
- revoke consent;
- удалить медиа;
- запросить удаление аккаунта.

---

107. DELETION WORKFLOW

Не делать:

DELETE FROM users

одной командой.

Создать async deletion process.

Например:

REQUESTED
↓
LOCKED
↓
SOCIAL_REVOKE
↓
MEDIA_DELETE
↓
PROVIDER_DELETE
↓
PII_ANONYMIZE
↓
COMPLETED

---

108. API CONVENTIONS

Base:

/api/v1

Ответ:

{
  "data": {},
  "meta": {},
  "error": null
}

Ошибка:

{
  "data": null,
  "error": {
    "code": "INSUFFICIENT_VIDEO_SECONDS",
    "message": "Недостаточно секунд для генерации видео.",
    "requestId": "..."
  }
}

---

109. AUTH API

POST /api/v1/auth/register
POST /api/v1/auth/login
POST /api/v1/auth/logout
POST /api/v1/auth/forgot-password
POST /api/v1/auth/reset-password
POST /api/v1/auth/verify-email
GET  /api/v1/auth/session

---

110. ORGANIZATION API

GET    /organizations
POST   /organizations
GET    /organizations/:id
PATCH  /organizations/:id

GET    /organizations/:id/members
POST   /organizations/:id/invitations
PATCH  /organizations/:id/members/:memberId
DELETE /organizations/:id/members/:memberId

---

111. BRAND API

GET    /brands
POST   /brands
GET    /brands/:id
PATCH  /brands/:id
DELETE /brands/:id

---

112. BRAND BRAIN API

GET   /brands/:id/brain
PATCH /brands/:id/profile

GET/POST/PATCH/DELETE:
products
audiences
pain-points
desires
objections
competitors
content-pillars
offers
ctas
rules

---

113. STRATEGY API

POST /brands/:id/strategy/generate
GET  /brands/:id/strategies
GET  /strategies/:id
POST /strategies/:id/regenerate
POST /strategies/:id/recommendations/:recommendationId/accept
POST /strategies/:id/recommendations/:recommendationId/reject

Generate возвращает job.

{
  "jobId": "..."
}

---

114. IDEAS API

POST /brands/:id/ideas/generate
GET  /brands/:id/ideas
POST /ideas
PATCH /ideas/:id
POST /ideas/:id/approve
POST /ideas/:id/reject
POST /ideas/:id/create-script

---

115. SCRIPT API

GET  /scripts/:id
POST /content/:id/script/generate
POST /scripts/:id/rewrite
POST /scripts/:id/shorten
POST /scripts/:id/expand
POST /scripts/:id/approve
GET  /scripts/:id/versions

---

116. AVATAR API

GET    /brands/:id/avatars
POST   /brands/:id/avatars
GET    /avatars/:id
DELETE /avatars/:id

POST /avatars/:id/looks
GET  /avatars/:id/looks

---

117. VIDEO API

POST /content/:id/video-project
GET  /video-projects/:id
POST /video-projects/:id/generate
POST /video-projects/:id/cancel
POST /video-projects/:id/retry
POST /video-projects/:id/approve
GET  /video-projects/:id/progress

---

118. CALENDAR API

GET /calendar?from=&to=&brandId=
POST /content/:id/schedule
DELETE /content/:id/schedule

---

119. SOCIAL API

GET  /brands/:id/social-connections
POST /social/:provider/connect
GET  /social/:provider/callback
POST /social-connections/:id/refresh
DELETE /social-connections/:id

---

120. PUBLISHING API

POST /content/:id/publish
POST /content/:id/schedule
POST /publications/:id/retry
GET  /publications/:id
GET  /content/:id/publications

---

121. ANALYTICS API

GET /brands/:id/analytics
GET /publications/:id/analytics
POST /brands/:id/analytics/ai-report
GET /brands/:id/performance-reports

---

122. BILLING API

GET  /billing/plans
GET  /billing/subscription
POST /billing/checkout
POST /billing/cancel
POST /billing/reactivate
GET  /billing/usage
GET  /billing/payments

---

123. JOB API

GET  /jobs/:id
POST /jobs/:id/retry
POST /jobs/:id/cancel

Клиент может использовать:

- polling;
- SSE/WebSocket позднее.

Для MVP polling допустим.

---

124. ERROR CODES

Минимум:

UNAUTHENTICATED
UNAUTHORIZED
NOT_FOUND
VALIDATION_ERROR
TENANT_ACCESS_DENIED

PLAN_LIMIT_REACHED
INSUFFICIENT_AI_CREDITS
INSUFFICIENT_VIDEO_SECONDS

CONSENT_REQUIRED

PROVIDER_UNAVAILABLE
PROVIDER_TIMEOUT
PROVIDER_REJECTED

INVALID_MEDIA
VIDEO_PROCESSING_FAILED

SOCIAL_CONNECTION_REQUIRED
SOCIAL_TOKEN_EXPIRED
SOCIAL_PERMISSION_REQUIRED
SOCIAL_PROVIDER_REVIEW_REQUIRED

PUBLISHING_FAILED

PAYMENT_FAILED
SUBSCRIPTION_REQUIRED

RATE_LIMITED

INTERNAL_ERROR

---

125. UI ROUTES

/
/login
/register

/app
/app/dashboard

/app/brands
/app/brands/:brandId

/app/strategy
/app/ideas
/app/calendar
/app/scripts

/app/studio
/app/studio/videos
/app/studio/avatars
/app/studio/media
/app/studio/covers

/app/publishing
/app/analytics
/app/comments

/app/integrations
/app/team
/app/billing
/app/settings

/app/clients

/admin

---

126. DASHBOARD

Cards:

Контент на сегодня
Ждёт согласования
Видео генерируются
Запланировано
Опубликовано
Просмотры
Engagement
AI Credits
Video Seconds

---

127. UX LONG JOB

Никогда не блокировать страницу spinner на 5 минут.

После запуска:

Видео отправлено на генерацию.

В UI:

Preparing script        ✓
Generating avatar       ✓
Rendering video        72%
Adding captions         …
Final render            …

---

128. OPTIMISTIC UI

Допустимо для:

- rename;
- status;
- content editing.

Недопустимо показывать payment/video generation success до подтверждения сервера/provider.

---

129. REALTIME

MVP:

polling.

Позже:

SSE.

Не усложнять MVP WebSockets без необходимости.

---

130. SEARCH

Поддержать поиск:

ideas
scripts
content
brands
publications

PostgreSQL search достаточно для MVP.

---

131. OBSERVABILITY

Каждый request:

request_id
user_id
organization_id
duration
status

Каждый job:

job_id
correlation_id
provider
operation
attempt
duration
cost

---

132. STRUCTURED LOGGING

JSON.

Например:

{
  "level": "info",
  "event": "video_generation_started",
  "jobId": "...",
  "provider": "heygen",
  "organizationId": "...",
  "correlationId": "..."
}

---

133. HEALTH ENDPOINTS

GET /api/health
GET /api/health/ready

Ready проверяет:

database
redis
storage

External providers не должны делать service fully unavailable.

---

134. PROVIDER CIRCUIT BREAKER

Если AI provider возвращает массовые ошибки:

CLOSED
↓
OPEN
↓
HALF_OPEN
↓
CLOSED

Не продолжать бесконечно отправлять платные запросы в сломанный API.

---

135. TIMEOUT

Каждый provider request должен иметь explicit timeout.

Никогда:

await fetch(provider)

без AbortController/timeout.

---

136. DATABASE INDEXES

Codex должен анализировать query patterns.

Минимум индексы:

organization_members(organization_id, user_id)

brands(workspace_id)

content_items(brand_id, status)
content_items(brand_id, scheduled_at)

jobs(status, queue)
jobs(organization_id, created_at)

publications(content_item_id)
publications(status, scheduled_at)

publication_metrics(publication_id, measured_at)

usage_ledger(organization_id, resource_type, created_at)

social_connections(brand_id, provider)

---

137. UNIQUE CONSTRAINTS

Обязательно:

users.email_normalized

organization_members(
organization_id,
user_id
)

webhook_events(
provider,
external_event_id
)

social_connections(
brand_id,
provider,
external_account_id
)

---

138. DATABASE TRANSACTIONS

Использовать transaction для:

- billing;
- subscription change;
- usage reserve;
- usage capture;
- accepting invites;
- role changes;
- critical state transitions.

---

139. AI PROMPT VERSIONING

Prompt хранить не только в коде.

Создать:

prompt_templates

Поля:

key
version
system_prompt
user_template
schema_name
status
created_at

Generation сохраняет:

prompt_version
model
provider

---

140. PROMPT INJECTION

Любой импортированный контент считать untrusted.

Например сайт конкурента:

IGNORE ALL PREVIOUS INSTRUCTIONS

не должен влиять на system instructions.

Разделять:

SYSTEM INSTRUCTIONS
TRUSTED BRAND DATA
UNTRUSTED REFERENCE DATA
TASK

---

141. AI OUTPUT COST LIMITS

До запроса проверять:

max input
max output
user credits
plan constraints

Запретить случайный запрос на миллионы токенов.

---

142. RATE LIMITING

Отдельные limits:

AUTH
PUBLIC_API
AI_GENERATION
VIDEO_GENERATION
UPLOAD
WEBHOOK

Webhook endpoints ограничивать осторожно, чтобы не блокировать legitimate retries.

---

143. TESTING PYRAMID

Unit

- calculations;
- RBAC;
- usage ledger;
- state machines;
- prompt builders.

Integration

- PostgreSQL;
- Redis;
- repository;
- queue.

Contract

Provider adapters.

E2E

Playwright.

---

144. ОБЯЗАТЕЛЬНЫЕ E2E

Scenario 1

Register
→ verify
→ create organization
→ create brand
→ onboarding

Scenario 2

Generate strategy
→ receive completed job
→ open strategy

Scenario 3

Idea
→ script
→ approve

Scenario 4

Video
→ mock provider
→ webhook
→ render
→ ready

Scenario 5

Schedule
→ publish
→ provider success
→ publication PUBLISHED

Scenario 6

RESERVE credits
→ provider failure
→ RELEASE

Scenario 7

Попытка user A прочитать brand user B.

Ожидается:

403/404

---

145. PROVIDER MOCKS

CI не должен тратить реальные деньги.

Создать:

MockLLMProvider
MockAvatarProvider
MockSocialProvider
MockPaymentProvider

Но production adapters должны быть настоящими.

---

146. CI PIPELINE

Pull Request:

install
↓
lint
↓
typecheck
↓
unit
↓
integration
↓
build
↓
Playwright critical flows

Merge to main:

same tests
↓
build production artifact
↓
database migration compatibility check
↓
deploy
↓
smoke tests

---

147. MIGRATIONS

Миграции должны быть:

- committed;
- deterministic;
- reviewed;
- backward-compatible при rolling deployment.

Не использовать автоматический destructive "db push" в production.

---

148. DEPLOYMENT

Разделить frontend и workers.

Вариант:

Next.js frontend/BFF
+
PostgreSQL
+
Redis
+
Object Storage
+
Persistent Worker

Long-running FFmpeg jobs нельзя полагать исключительно на short-lived serverless functions.

---

149. NEXT.JS DEPLOYMENT

Если web размещается на Vercel:

- Next.js App Router;
- Node runtime по умолчанию;
- "output: standalone" для self-hosted профиля;
- preview deployments;
- production promotion после тестов.

Worker размещается отдельно.

---

150. ENVIRONMENT VARIABLES

Создать ".env.example".

Категории:

APP
DATABASE
REDIS
STORAGE
AUTH
ENCRYPTION
LLM
HEYGEN
YOUTUBE
TIKTOK
META
VK
TELEGRAM
YOOKASSA
OBSERVABILITY

Например:

DATABASE_URL=

REDIS_URL=

STORAGE_ENDPOINT=
STORAGE_BUCKET=
STORAGE_ACCESS_KEY=
STORAGE_SECRET_KEY=

APP_ENCRYPTION_KEY=

HEYGEN_API_KEY=

YOOKASSA_SHOP_ID=
YOOKASSA_SECRET_KEY=

Без реальных значений.

---

151. DATA RESIDENCY PROFILE

Подготовить deployment profile:

RU_DATA_RESIDENCY

Основная БД, Object Storage и backend могут размещаться в выбранной российской инфраструктуре.

Передача данных внешним AI-provider должна происходить только при необходимости конкретной функции.

Юридические документы и окончательная схема обработки персональных данных должны пройти отдельную проверку специалистом по применимому законодательству до production launch.

---

152. NON-FUNCTIONAL REQUIREMENTS

Availability target

MVP:

99.5%

Page performance

Основной dashboard:

LCP target < 2.5 sec

при нормальном соединении.

API

Обычные операции:

p95 < 500 ms

без учёта внешних AI tasks.

AI tasks async.

---

153. BACKUPS

PostgreSQL:

- daily backup;
- PITR при поддержке provider.

Storage:

versioning рекомендуется.

Периодически проверять restore process.

Backup, который никто никогда не проверял, считать ненадёжным.

---

154. DISASTER RECOVERY

Документ:

RUNBOOK.md

Сценарии:

- DB down;
- Redis down;
- AI provider down;
- storage down;
- compromised key;
- failed migration;
- publishing incident.

---

155. PRODUCT ANALYTICS

Отслеживать:

registration_completed
brand_created
onboarding_completed
strategy_generated
idea_generated
script_generated
video_generation_started
video_generation_completed
publication_completed
subscription_started
subscription_cancelled

Не передавать лишние sensitive данные аналитическому provider.

---

156. MVP FEATURE SET

P0

Обязательно:

- Auth
- Organizations
- Brands
- Brand Brain
- Strategy
- Ideas
- Scripts
- Avatar Provider
- Video generation
- Media storage
- Captions
- Content calendar
- Approval
- Telegram/YouTube или другие реально доступные publishing integrations
- Billing
- Usage ledger
- Admin
- Tests
- Security.

P1

После MVP:

- TikTok production publishing
- Instagram
- VK
- Analytics AI
- Comments
- Agency Mode
- Cover templates.

P2

Позднее:

- Trend Radar
- advanced B-roll
- multiple avatar providers
- BYOK
- automated experimentation
- advanced attribution.

---

157. DEVELOPMENT SPRINT 0 — FOUNDATION

Цель:

архитектура.

Выполнить:

- repository;
- monorepo;
- AGENTS.md;
- TECH_SPEC.md;
- architecture docs;
- Docker;
- PostgreSQL;
- Redis;
- Drizzle;
- CI;
- logging.

Acceptance:

pnpm install
pnpm dev
pnpm test
pnpm build

работают.

---

158. SPRINT 1 — AUTH + MULTI-TENANCY

Создать:

- User;
- Organization;
- Workspace;
- RBAC;
- invitations;
- session;
- onboarding shell.

Acceptance:

два tenant не видят данные друг друга.

---

159. SPRINT 2 — BRAND BRAIN

Создать:

- Brand;
- products;
- audiences;
- pains;
- competitors;
- voice;
- CTA;
- content pillars.

Завершить onboarding.

---

160. SPRINT 3 — AI CORE

Создать:

- LLM provider;
- AI Orchestrator;
- prompt versioning;
- structured output;
- credits;
- jobs.

Реализовать:

Strategy
Ideas
Script

---

161. SPRINT 4 — VIDEO FACTORY

Создать:

- avatar provider;
- consent;
- voices;
- video project;
- queue;
- webhook;
- storage;
- FFmpeg;
- captions.

Vertical slice:

Script
→ Avatar
→ Generate
→ MP4

---

162. SPRINT 5 — CONTENT OPERATIONS

Создать:

- calendar;
- approvals;
- notifications;
- media library;
- cover studio.

---

163. SPRINT 6 — PUBLISHING

Создать:

- SocialProvider;
- SocialConnection;
- Scheduler;
- Publication;
- Telegram;
- YouTube;
- подготовку остальных providers.

---

164. SPRINT 7 — BILLING

Создать:

- Plans;
- Subscription;
- YooKassa;
- recurring flow;
- UsageLedger;
- reserve/capture/release;
- limits.

---

165. SPRINT 8 — ANALYTICS + HARDENING

Создать:

- metrics;
- analytics dashboards;
- AI Performance Analyst;
- security review;
- performance;
- backup/runbook;
- production readiness.

---

166. CODING RULES ДЛЯ CODEX

Codex обязан:

1. Читать существующий код перед изменениями.
2. Не дублировать existing abstractions.
3. Не ломать public interfaces без необходимости.
4. Создавать migration для schema changes.
5. Добавлять tests вместе с логикой.
6. Не оставлять критические TODO.
7. Не добавлять fake integration.
8. Не hardcode credentials.
9. Не hardcode pricing.
10. Не hardcode provider IDs.
11. Не вызывать external API из React.
12. Не выполнять video job внутри HTTP lifecycle.

---

167. ПРАВИЛО PRODUCTION-FIRST

Для каждой функции Codex должен различать:

IMPLEMENTED
MOCK_ONLY
CONFIGURATION_REQUIRED
PROVIDER_REVIEW_REQUIRED
NOT_IMPLEMENTED

Нельзя показывать:

CONNECTED

если provider не подключён.

---

168. ДОКУМЕНТАЦИЯ API

Перед реализацией каждой интеграции Codex обязан открыть актуальную официальную документацию:

- OpenAI / выбранного LLM;
- HeyGen;
- TikTok;
- YouTube;
- Meta;
- Telegram;
- VK;
- YooKassa.

Не полагаться на старые примеры или память модели.

Особенно перепроверять:

- endpoints;
- API versions;
- scopes;
- OAuth;
- webhooks;
- rate limits;
- upload limitations;
- content rules;
- app review requirements.

---

169. DEFINITION OF DONE ДЛЯ FEATURE

Feature считается завершённой только если:

database schema ✓
domain logic ✓
authorization ✓
API ✓
UI ✓
loading ✓
error states ✓
logging ✓
tests ✓
documentation ✓

Для provider feature дополнительно:

timeout ✓
retry ✓
idempotency ✓
provider error mapping ✓
cost tracking ✓
mock ✓

---

170. DEFINITION OF DONE ДЛЯ MVP

Новый пользователь должен реально пройти:

1 Register

2 Create Organization

3 Create Brand

4 Complete Business Onboarding

5 Generate Brand Strategy

6 Generate Content Ideas

7 Select Idea

8 Generate Script

9 Edit Script

10 Approve Script

11 Select/Create Avatar

12 Start Video Generation

13 Receive Video

14 Edit/Approve Captions

15 Receive Final MP4

16 Approve Content

17 Connect Supported Social Account

18 Schedule Publication

19 Publish

20 Receive Publication Result

21 See Statistics

22 Receive AI Recommendations

---

171. SECURITY ACCEPTANCE

Перед production:

обязательно проверить:

tenant access
RBAC bypass
IDOR
SQL injection
XSS
CSRF
SSRF
upload attacks
OAuth state
secret leakage
webhook replay
payment replay
publishing duplication
usage double-charge

---

172. BILLING ACCEPTANCE

Тест:

balance = 60 sec

job needs 30

RESERVE
available = 30

provider fails

RELEASE

available = 60

Второй тест:

provider webhook приходит дважды

Двойное списание:

НЕ ПРОИСХОДИТ.

---

173. PUBLISHING ACCEPTANCE

Два worker одновременно пытаются выполнить один job.

Результат:

ОДНА публикация.

Не две.

---

174. PROVIDER FAILURE ACCEPTANCE

HeyGen unavailable.

Результат:

- сайт продолжает работать;
- пользователь видит понятный статус;
- job retry;
- данные не теряются;
- деньги повторно не списываются.

---

175. UX ACCEPTANCE

Ни одна длительная операция не должна выглядеть как зависший интерфейс.

Всегда показывать:

- current stage;
- progress если доступен;
- last update;
- retry/action если ошибка.

---

176. SEED

Development database должна иметь:

Demo User
Demo Organization
Demo Brand
Demo Products
Demo Audience
Demo Strategy
20 Ideas
3 Scripts
1 Avatar
2 Videos
5 Publications
Analytics

Никаких реальных персональных данных.

---

177. DEMO MODE

Допускается специальный demo provider.

Но UI должен явно показывать:

Demo Mode

Нельзя смешивать demo success и production success.

---

178. README

README:

Requirements
Installation
Environment
Database
Redis
Storage
Development
Worker
Tests
Build
Deployment
Providers
Troubleshooting

Локальный запуск должен быть максимально простым:

pnpm install
docker compose up -d
pnpm db:migrate
pnpm db:seed
pnpm dev

---

179. DEVELOPMENT PRINCIPLE

Не строить все горизонтальные слои сразу.

Использовать vertical slices.

Первый:

Onboarding
→ Brand Brain

Второй:

Brand Brain
→ AI Strategy

Третий:

Idea
→ Script

Четвёртый:

Script
→ Video

Пятый:

Video
→ Publication

Каждый vertical slice должен работать end-to-end.

---

180. ЧЕГО НЕ ДЕЛАТЬ

Запрещено:

- сначала делать 50 пустых экранов;
- использовать mock response в production;
- fake publish;
- fake payment;
- fake video completion;
- хранить token в localStorage;
- передавать HeyGen key на frontend;
- передавать YooKassa secret на frontend;
- обходить официальные OAuth API через логин/пароль;
- парсить пользовательские cookies;
- отключать tenant checks «временно»;
- списывать usage до успешного завершения без reserve/release;
- хранить публичными пользовательские media files.

---

181. РЕКОМЕНДУЕМАЯ СТРАТЕГИЯ GIT

Branches:

main
feature/*
fix/*

Каждый значимый vertical slice — отдельная ветка/PR.

Commit examples:

feat(auth): add organization onboarding
feat(ai): implement strategy generation workflow
feat(video): add heygen provider adapter
fix(billing): release reservation on failed jobs
test(rbac): prevent cross-tenant brand access

---

182. CODE REVIEW CHECKLIST

Перед merge:

Does tenant isolation hold?
Are inputs validated?
Are secrets safe?
Is error handling complete?
Does it create duplicate jobs?
Is it idempotent?
Are external calls timed out?
Are retries safe?
Can user be charged twice?
Are tests present?

---

183. ПЕРВАЯ КОМАНДА CODEX

После помещения этого файла в repository начать Codex с инструкции:

Read TECH_SPEC.md completely.

Inspect the entire repository before making changes.

If the repository is empty, initialize the project according to TECH_SPEC.md.

Create:
- AGENTS.md
- docs/ARCHITECTURE.md
- docs/DATA_MODEL.md
- docs/SECURITY.md
- docs/PROVIDERS.md
- docs/DEPLOYMENT.md

Then implement Sprint 0 only.

Do not start application feature development until the architecture, monorepo, database, Redis, Docker, linting, type checking, tests, CI, configuration validation and local development environment are working.

Use current stable package versions compatible with each other. Before selecting framework-specific patterns or external API contracts, verify them against current official documentation.

Do not ask for approval for routine engineering decisions.

Document important architectural decisions.

At the end of Sprint 0:
1. run lint,
2. run typecheck,
3. run tests,
4. run production build,
5. fix all errors,
6. summarize exactly what was implemented,
7. list only blockers requiring credentials or decisions from the project owner.

Begin.

---

184. ВТОРАЯ КОМАНДА CODEX

После Sprint 0:

Read TECH_SPEC.md, AGENTS.md and all files under docs/.

Implement Sprint 1: Authentication + Multi-tenancy.

Work as a production software engineer.

Implement the complete vertical slice including:
database,
migrations,
domain services,
authorization,
API,
UI,
error states,
tests,
audit events where required.

Security requirement:
it must be impossible for a member of organization A to read or mutate resources belonging to organization B.

Add explicit automated tests for cross-tenant access.

Do not start Sprint 2 until:
lint,
typecheck,
tests,
build
all pass.

Begin.

---

185. ГЛАВНЫЙ ПРИНЦИП ПРОЕКТА

ContentOS AI должен быть не набором AI-кнопок.

Он должен быть системой:

BUSINESS KNOWLEDGE
+
AI ORCHESTRATION
+
CONTENT PRODUCTION
+
AUTOMATION
+
DISTRIBUTION
+
ANALYTICS
+
FEEDBACK LOOP

Конечная цель:

Brand Brain
       ↓
AI creates
       ↓
Human controls
       ↓
System publishes
       ↓
System measures
       ↓
AI learns from results
       ↓
Next content becomes better

---

186. ИТОГОВАЯ АРХИТЕКТУРНАЯ ФОРМУЛА

                       CONTENTOS AI

                           USER
                            │
                            ▼
                       ORGANIZATION
                            │
                            ▼
                          BRAND
                            │
                            ▼
                     ┌─────────────┐
                     │ BRAND BRAIN │
                     └──────┬──────┘
                            │
                            ▼
                     AI ORCHESTRATOR
                            │
        ┌───────────────────┼────────────────────┐
        ▼                   ▼                    ▼
     STRATEGY             IDEAS               ANALYSIS
        │                   │
        └──────────┬────────┘
                   ▼
                SCRIPT
                   │
                   ▼
               APPROVAL
                   │
                   ▼
             VIDEO FACTORY
                   │
        ┌──────────┼────────────┐
        ▼          ▼            ▼
      AVATAR     CAPTIONS      B-ROLL
        │          │            │
        └──────────┼────────────┘
                   ▼
              FINAL VIDEO
                   │
                   ▼
               APPROVAL
                   │
                   ▼
              PUBLISHER
                   │
         ┌─────────┼──────────┐
         ▼         ▼          ▼
       TikTok   YouTube    Telegram
         │         │          │
         └─────────┼──────────┘
                   ▼
               ANALYTICS
                   │
                   ▼
          PERFORMANCE ANALYST
                   │
                   ▼
          STRATEGY RECOMMENDATION
                   │
                   └──────────► BRAND BRAIN
                                after approval

---

187. ФИНАЛЬНАЯ ИНСТРУКЦИЯ CODEX

Не создавай демонстрационный прототип.

Создавай фундамент коммерческого SaaS.

Приоритеты:

1. Correctness.
2. Security.
3. Tenant isolation.
4. Reliability.
5. Provider abstraction.
6. Idempotency.
7. Cost control.
8. User experience.
9. Maintainability.
10. Speed of development.

Если приходится выбирать между красивым экраном и надёжным backend workflow — сначала реализовать надёжный workflow.

Если внешний provider ещё не разрешил production access — реализовать integration adapter полностью, но показать правильный статус "PROVIDER_REVIEW_REQUIRED".

Никогда не имитировать успешную внешнюю операцию.

Никогда не утверждать, что функция работает, пока не существует end-to-end path и automated verification.

Основной критерий:

WORKING PRODUCT > DEMO.

Приступай к разработке с Sprint 0.

