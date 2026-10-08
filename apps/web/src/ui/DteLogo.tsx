/** DTE GmbH – Die Trocknungsexperten. Redrawn as SVG so it stays sharp and follows light/dark mode. */
export function DteLogo({
  className,
  tagline = true,
}: {
  className?: string;
  tagline?: boolean;
}) {
  const font = "'Open Sans', Inter, 'Helvetica Neue', Arial, sans-serif";
  return (
    <svg
      viewBox={`0 0 1600 ${tagline ? 690 : 556}`}
      className={className}
      role="img"
      aria-label="DTE GmbH – Die Trocknungsexperten"
    >
      <path
        fill="var(--dte-teal)"
        d="M12 118C400 45 800 10 1000 14c300 6 590 106 580 316l-2 50c-18-130-228-290-578-335C700 25 300 60 12 118z"
      />
      <g fill="var(--dte-green)">
        <path
          fillRule="evenodd"
          d="M18 190h152c90 0 148 60 148 177s-58 178-148 178H18zm72 62h68c57 0 84 38 84 115s-27 115-84 115H90z"
        />
        <path d="M318 190h288v62H500v293h-74V252H318z" />
        <path d="M635 190h260v62H707v76h173v62H707v91h198v64H635z" />
        <text
          x="978"
          y="546"
          fontSize="215"
          fontFamily={font}
          textLength="600"
          lengthAdjust="spacingAndGlyphs"
        >
          GmbH
        </text>
      </g>
      {tagline && (
        <text
          x="16"
          y="678"
          fill="var(--dte-teal)"
          fontSize="106"
          fontWeight="600"
          fontFamily={font}
          textLength="1566"
          lengthAdjust="spacingAndGlyphs"
        >
          DIE TROCKNUNGSEXPERTEN
        </text>
      )}
    </svg>
  );
}
