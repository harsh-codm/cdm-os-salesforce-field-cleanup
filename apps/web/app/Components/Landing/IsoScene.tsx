/**
 * Isometric glass-cube illustrations for the Problem cards. Parts carry
 * data-* hooks that the motion layer (useLandingMotion) animates:
 *   data-cube     — a cube group that slides / bobs
 *   data-redline  — a dashed "broken link" line drawn in after the split
 *   data-mark     — a small red marker that pops
 *   data-ring     — a ring that rotates / pulses
 *   data-tag      — a label chip that pops in with a bounce
 */
import s from "./landing.module.css";

const SIZE = 40;
const DX = SIZE * 0.866;
const DY = SIZE * 0.5;

function Cube({
  x,
  y,
  label,
  index,
  hot = false,
}: {
  x: number;
  y: number;
  label: string;
  index: number;
  hot?: boolean;
}) {
  // (x, y) is the front-top vertex of the cube.
  const top = `${x},${y - SIZE} ${x + DX},${y - DY} ${x},${y} ${x - DX},${y - DY}`;
  const left = `${x - DX},${y - DY} ${x},${y} ${x},${y + SIZE} ${x - DX},${y + DY}`;
  const right = `${x},${y} ${x + DX},${y - DY} ${x + DX},${y + DY} ${x},${y + SIZE}`;
  const tx = x - DX / 2;
  const ty = y + DY / 2 + 4;
  return (
    <g data-cube={index} className={hot ? s.isoHot : undefined}>
      <polygon points={left} className={s.isoFaceL} />
      <polygon points={right} className={s.isoFaceR} />
      <polygon points={top} className={s.isoFaceT} />
      <text x={tx} y={ty} className={s.isoText} transform={`rotate(30 ${tx} ${ty})`} textAnchor="middle">
        {label}
      </text>
    </g>
  );
}

function Axes() {
  return (
    <g className={s.isoAxes}>
      <line data-axis="h" x1="30" y1="130" x2="330" y2="130" />
      <line data-axis="v" x1="180" y1="20" x2="180" y2="240" />
      <line data-axis="d" x1="60" y1="199" x2="300" y2="61" />
      <circle cx="300" cy="61" r="2.5" />
      <circle cx="60" cy="199" r="2.5" />
    </g>
  );
}

function Tag({ x, y, children }: { x: number; y: number; children: string }) {
  const w = children.length * 6.4 + 12;
  return (
    <g data-tag className={s.isoTag} transform={`translate(${x} ${y})`}>
      <rect x={-w / 2} y={-9} width={w} height={18} />
      <text y={4} textAnchor="middle">
        {children}
      </text>
    </g>
  );
}

export default function IsoScene({ variant, labels }: { variant: 0 | 1 | 2; labels: string[] }) {
  return (
    <svg viewBox="0 0 360 260" className={s.iso} data-scene={variant} aria-hidden="true" focusable="false">
      <Axes />

      {variant === 0 && (
        <>
          {/* Three systems start fused in a row and drift apart: nothing syncs. */}
          <path data-redline d="M118 150 L180 114 L242 78" className={s.isoRed} />
          <g data-mark className={s.isoMark} transform="translate(150 104)">
            <path d="M-4 -4 4 4M4 -4 -4 4" />
          </g>
          <g data-mark className={s.isoMark} transform="translate(212 68)">
            <path d="M-4 -4 4 4M4 -4 -4 4" />
          </g>
          {/* back-to-front draw order */}
          <Cube x={215} y={92} label={labels[2]} index={2} />
          <Cube x={180} y={112} label={labels[1]} index={1} />
          <Cube x={145} y={132} label={labels[0]} index={0} />
        </>
      )}

      {variant === 1 && (
        <>
          {/* An agent cube orbited by a risk ring, repeatedly lunging at the API cube. */}
          <g data-ring className={s.isoRing}>
            <ellipse cx="150" cy="140" rx="78" ry="45" />
          </g>
          <g data-ring-pulse className={s.isoRingPulse}>
            <ellipse cx="150" cy="140" rx="54" ry="31" />
          </g>
          <g data-mark className={s.isoSpark} transform="translate(206 104)">
            <circle r="5" />
          </g>
          <Cube x={238} y={84} label={labels[2]} index={2} hot />
          <Cube x={203} y={104} label={labels[1]} index={1} />
          <Cube x={150} y={128} label={labels[0]} index={0} />
        </>
      )}

      {variant === 2 && (
        <>
          {/* A change with no trail: the questions pop up one after another. */}
          <path data-redline d="M128 160 L240 96" className={s.isoRed} />
          <Cube x={232} y={86} label={labels[1]} index={1} />
          <Cube x={140} y={140} label={labels[0]} index={0} />
          <Tag x={96} y={78}>{labels[2] ?? "Who?"}</Tag>
          <Tag x={262} y={180}>Why?</Tag>
          <Tag x={190} y={44}>Undo?</Tag>
        </>
      )}
    </svg>
  );
}
