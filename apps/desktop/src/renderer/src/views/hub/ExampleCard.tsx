import { useT } from '@open-codesign/i18n';
import type { ExampleCategory, LocalizedExample } from '@open-codesign/templates';
import {
  FileText,
  LayoutDashboard,
  type LucideIcon,
  Mail,
  Megaphone,
  MonitorSmartphone,
  Palette,
  Presentation,
  Smartphone,
  Sparkles,
} from 'lucide-react';

export interface ExampleCardProps {
  example: LocalizedExample;
  onUsePrompt: (example: LocalizedExample) => void;
}

// Curated palette per category. Two stops give each cover a subtle gradient
// without pretending to be a UI screenshot. Keep these muted and warm — they
// should read as editorial, not as branded decoration.
const CATEGORY_SKIN: Record<
  ExampleCategory,
  { icon: LucideIcon; from: string; to: string; ink: string; accent: string }
> = {
  animation: {
    icon: Sparkles,
    from: '#1b1340',
    to: '#06020f',
    ink: '#f5edff',
    accent: '#ffd27a',
  },
  ui: {
    icon: Palette,
    from: '#f5efe3',
    to: '#ede2d0',
    ink: '#3b2f4a',
    accent: '#c58ff0',
  },
  marketing: {
    icon: Megaphone,
    from: '#fbfaf6',
    to: '#f0ead9',
    ink: '#1f2937',
    accent: '#b4551e',
  },
  document: {
    icon: FileText,
    from: '#141417',
    to: '#0a0a0d',
    ink: '#f4f4f5',
    accent: '#fbbf24',
  },
  dashboard: {
    icon: LayoutDashboard,
    from: '#0b1222',
    to: '#060a15',
    ink: '#dbeafe',
    accent: '#34d399',
  },
  presentation: {
    icon: Presentation,
    from: '#fffaf0',
    to: '#fbefd9',
    ink: '#1f2937',
    accent: '#f97316',
  },
  email: {
    icon: Mail,
    from: '#eef2ff',
    to: '#dfe6ff',
    ink: '#1e1b4b',
    accent: '#4338ca',
  },
  mobile: {
    icon: Smartphone,
    from: '#ecfdf5',
    to: '#d1fae5',
    ink: '#064e3b',
    accent: '#065f46',
  },
};

const FALLBACK_SKIN = {
  icon: MonitorSmartphone,
  from: '#f5efe3',
  to: '#ede2d0',
  ink: '#3b2f4a',
  accent: '#c58ff0',
} as const;

export function ExampleCard({ example, onUsePrompt }: ExampleCardProps) {
  const t = useT();
  const skin = CATEGORY_SKIN[example.category] ?? FALLBACK_SKIN;
  const Icon = skin.icon;

  return (
    <article className="group flex flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] transition-[border-color,transform,box-shadow] duration-[var(--duration-base)] ease-[var(--ease-out)] hover:-translate-y-[2px] hover:border-[var(--color-border-strong)] hover:shadow-[var(--shadow-card)]">
      <div
        className="relative aspect-[16/10] w-full overflow-hidden"
        style={{
          background: `linear-gradient(145deg, ${skin.from} 0%, ${skin.to} 100%)`,
          color: skin.ink,
        }}
      >
        {/* SVG thumbnail — fades in on hover so the default card stays clean
            and editorial, but hovering reveals the concrete layout preview. */}
        <div
          aria-hidden
          className="absolute inset-0 opacity-0 transition-opacity duration-[var(--duration-base)] ease-[var(--ease-out)] group-hover:opacity-100"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: thumbnails are static bundled strings authored in-repo, not user content
          dangerouslySetInnerHTML={{ __html: example.thumbnail }}
        />
        {/* Gradient scrim under the title so text stays legible over the SVG */}
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-[62%] opacity-0 transition-opacity duration-[var(--duration-base)] ease-[var(--ease-out)] group-hover:opacity-95"
          style={{
            background: `linear-gradient(180deg, transparent 0%, ${skin.to} 92%)`,
          }}
        />
        {/* Large watermark glyph — visible on the resting state, fades out on hover */}
        <Icon
          aria-hidden
          strokeWidth={1}
          className="absolute -right-2 -bottom-4 w-[140px] h-[140px] opacity-[0.07] transition-opacity duration-[var(--duration-base)] ease-[var(--ease-out)] group-hover:opacity-0"
          style={{ color: skin.ink }}
        />
        {/* Accent dot */}
        <span
          aria-hidden
          className="absolute top-[var(--space-4)] left-[var(--space-4)] inline-block w-[8px] h-[8px] rounded-full"
          style={{ backgroundColor: skin.accent }}
        />
        {/* Category eyebrow */}
        <span
          className="absolute top-[var(--space-4)] left-[calc(var(--space-4)_+_16px)] text-[10px] uppercase tracking-[0.18em]"
          style={{ color: skin.ink, opacity: 0.55 }}
        >
          {t(`examples.categories.${example.category}`)}
        </span>
        {/* Title treatment */}
        <div className="absolute inset-x-[var(--space-4)] bottom-[var(--space-4)]">
          <h3
            className="line-clamp-2 text-[22px] leading-[1.15] font-medium tracking-[var(--tracking-heading)]"
            style={{ fontFamily: 'var(--font-display)', color: skin.ink }}
          >
            {example.title}
          </h3>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-[var(--space-3)] p-[var(--space-4)]">
        <p className="flex-1 text-[var(--font-size-body-sm)] leading-[var(--leading-body)] text-[var(--color-text-secondary)] line-clamp-3">
          {example.description}
        </p>
        <button
          type="button"
          onClick={() => onUsePrompt(example)}
          className="self-start rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-background)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-body-sm)] font-medium text-[var(--color-text-primary)] transition-[border-color,background-color,color,transform] duration-[var(--duration-faster)] ease-[var(--ease-out)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] active:scale-[var(--scale-press-down)]"
        >
          {t('examples.useThisPrompt')}
        </button>
      </div>
    </article>
  );
}
