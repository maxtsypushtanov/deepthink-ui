import { cn } from '@/lib/utils';

interface Props {
  className?: string;
  size?: number;
}

export function DeepThinkLogo({ className, size = 64 }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('', className)}
    >
      <defs>
        {/* Gradient for the core glow */}
        <radialGradient id="dt-core-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="hsl(var(--foreground))" stopOpacity="0.15" />
          <stop offset="100%" stopColor="hsl(var(--foreground))" stopOpacity="0" />
        </radialGradient>

        {/* Gradient for the orbital rings */}
        <linearGradient id="dt-ring-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="hsl(var(--foreground))" stopOpacity="0.6" />
          <stop offset="50%" stopColor="hsl(var(--foreground))" stopOpacity="0.15" />
          <stop offset="100%" stopColor="hsl(var(--foreground))" stopOpacity="0.6" />
        </linearGradient>

        {/* Gradient for the brain paths */}
        <linearGradient id="dt-brain-grad" x1="30%" y1="0%" x2="70%" y2="100%">
          <stop offset="0%" stopColor="hsl(var(--foreground))" stopOpacity="0.9" />
          <stop offset="100%" stopColor="hsl(var(--foreground))" stopOpacity="0.5" />
        </linearGradient>
      </defs>

      {/* Background glow */}
      <circle cx="60" cy="60" r="50" fill="url(#dt-core-glow)" />

      {/* Outer orbital ring — tilted ellipse */}
      <ellipse
        cx="60" cy="60" rx="46" ry="18"
        transform="rotate(-25 60 60)"
        stroke="url(#dt-ring-grad)"
        strokeWidth="1.2"
        fill="none"
        strokeLinecap="round"
      />

      {/* Second orbital ring — opposite tilt */}
      <ellipse
        cx="60" cy="60" rx="46" ry="18"
        transform="rotate(25 60 60)"
        stroke="url(#dt-ring-grad)"
        strokeWidth="1.2"
        fill="none"
        strokeLinecap="round"
      />

      {/* Third ring — vertical-ish */}
      <ellipse
        cx="60" cy="60" rx="44" ry="16"
        transform="rotate(80 60 60)"
        stroke="hsl(var(--foreground))"
        strokeWidth="0.8"
        strokeOpacity="0.12"
        fill="none"
      />

      {/* Stylized brain — left hemisphere */}
      <path
        d="M52 42 C44 42, 38 48, 38 55 C38 60, 40 64, 44 67 C42 70, 43 74, 47 76 C49 78, 53 78, 56 76 L58 60"
        stroke="url(#dt-brain-grad)"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />

      {/* Left hemisphere inner fold */}
      <path
        d="M44 52 C48 54, 50 58, 48 62"
        stroke="hsl(var(--foreground))"
        strokeWidth="1.5"
        strokeOpacity="0.4"
        strokeLinecap="round"
        fill="none"
      />

      {/* Stylized brain — right hemisphere */}
      <path
        d="M68 42 C76 42, 82 48, 82 55 C82 60, 80 64, 76 67 C78 70, 77 74, 73 76 C71 78, 67 78, 64 76 L62 60"
        stroke="url(#dt-brain-grad)"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />

      {/* Right hemisphere inner fold */}
      <path
        d="M76 52 C72 54, 70 58, 72 62"
        stroke="hsl(var(--foreground))"
        strokeWidth="1.5"
        strokeOpacity="0.4"
        strokeLinecap="round"
        fill="none"
      />

      {/* Corpus callosum — bridge between hemispheres */}
      <path
        d="M52 48 C56 44, 64 44, 68 48"
        stroke="hsl(var(--foreground))"
        strokeWidth="1.5"
        strokeOpacity="0.5"
        strokeLinecap="round"
        fill="none"
      />

      {/* Neural connection dots — thought nodes */}
      {/* Central top */}
      <circle cx="60" cy="38" r="2.5" fill="hsl(var(--foreground))" fillOpacity="0.8" />
      {/* Left thought */}
      <circle cx="36" cy="56" r="2" fill="hsl(var(--foreground))" fillOpacity="0.5" />
      {/* Right thought */}
      <circle cx="84" cy="56" r="2" fill="hsl(var(--foreground))" fillOpacity="0.5" />
      {/* Bottom left */}
      <circle cx="46" cy="79" r="1.8" fill="hsl(var(--foreground))" fillOpacity="0.4" />
      {/* Bottom right */}
      <circle cx="74" cy="79" r="1.8" fill="hsl(var(--foreground))" fillOpacity="0.4" />
      {/* Center — the "deep" core */}
      <circle cx="60" cy="60" r="3" fill="hsl(var(--foreground))" fillOpacity="0.9" />

      {/* Neural connections — dashed lines from core to nodes */}
      <line x1="60" y1="57" x2="60" y2="41" stroke="hsl(var(--foreground))" strokeWidth="0.8" strokeOpacity="0.25" strokeDasharray="2 3" />
      <line x1="57" y1="60" x2="38" y2="56" stroke="hsl(var(--foreground))" strokeWidth="0.8" strokeOpacity="0.2" strokeDasharray="2 3" />
      <line x1="63" y1="60" x2="82" y2="56" stroke="hsl(var(--foreground))" strokeWidth="0.8" strokeOpacity="0.2" strokeDasharray="2 3" />
      <line x1="58" y1="63" x2="47" y2="77" stroke="hsl(var(--foreground))" strokeWidth="0.8" strokeOpacity="0.15" strokeDasharray="2 3" />
      <line x1="62" y1="63" x2="73" y2="77" stroke="hsl(var(--foreground))" strokeWidth="0.8" strokeOpacity="0.15" strokeDasharray="2 3" />

      {/* Small orbital dots on the rings */}
      <circle cx="28" cy="50" r="1.5" fill="hsl(var(--foreground))" fillOpacity="0.35">
        <animate attributeName="fillOpacity" values="0.35;0.7;0.35" dur="3s" repeatCount="indefinite" />
      </circle>
      <circle cx="92" cy="70" r="1.5" fill="hsl(var(--foreground))" fillOpacity="0.35">
        <animate attributeName="fillOpacity" values="0.35;0.7;0.35" dur="3s" begin="1s" repeatCount="indefinite" />
      </circle>
      <circle cx="75" cy="30" r="1.2" fill="hsl(var(--foreground))" fillOpacity="0.25">
        <animate attributeName="fillOpacity" values="0.25;0.6;0.25" dur="4s" begin="0.5s" repeatCount="indefinite" />
      </circle>
      <circle cx="45" cy="90" r="1.2" fill="hsl(var(--foreground))" fillOpacity="0.25">
        <animate attributeName="fillOpacity" values="0.25;0.6;0.25" dur="4s" begin="2s" repeatCount="indefinite" />
      </circle>
    </svg>
  );
}
