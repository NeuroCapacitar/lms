import { useRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';

import {
  FIELD_IDS,
  FIELD_LABELS,
  FRAME_MM,
  PAGE,
  fitFontSize,
  isTextField,
  type CertificateLayout,
  type FieldId,
  type LayoutField,
} from '../../features/certificate/layout';
import { signatureSrc } from '../api/certificate';

/**
 * A página A4 do editor (M7-03). Cada campo é um BOTÃO posicionado em milímetros (percentual da página), então é
 * focável: setas movem 1 mm, Shift+setas 5 mm, Alt+setas redimensionam. O ponteiro arrasta (e redimensiona pela alça);
 * o painel numérico é a alternativa a arrastar (WCAG 2.5.7). O texto usa o MESMO ajuste de corpo do PDF
 * (`fitFontSize`). A prévia é DOM, não iframe: a CSP do app (sem estilo inline) esvaziaria um iframe; o PDF real é
 * conferido pelo gate do M7-09.
 */
const PT_TO_CQW = (25.4 / 72 / PAGE.width) * 100;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const round = (value: number) => Math.round(value * 2) / 2;

export interface CanvasProps {
  layout: CertificateLayout;
  /** Texto de exemplo de cada campo de texto. */
  samples: Partial<Record<FieldId, string>>;
  backgroundMediaId: string | null;
  signatureMediaId: string | null;
  selected: FieldId | null;
  readOnly: boolean;
  onSelect: (id: FieldId) => void;
  /** Mudança em andamento (arrastar): não vira passo do desfazer. */
  onLive: (id: FieldId, patch: Partial<LayoutField>) => void;
  /** Mudança concluída (soltou o ponteiro, ou tecla): vira um passo do desfazer. */
  onCommit: (id: FieldId, patch: Partial<LayoutField>) => void;
  problemIds: ReadonlySet<FieldId>;
}

function boxStyle(field: LayoutField): CSSProperties {
  return {
    left: `${(field.x / PAGE.width) * 100}%`,
    top: `${(field.y / PAGE.height) * 100}%`,
    width: `${(field.w / PAGE.width) * 100}%`,
    height: `${(field.h / PAGE.height) * 100}%`,
  };
}

export function CertificateCanvas(props: CanvasProps) {
  const drag = useRef<{
    id: FieldId;
    mode: 'move' | 'resize';
    startX: number;
    startY: number;
    origin: LayoutField;
    unitPx: number;
    moved: boolean;
  } | null>(null);
  const page = useRef<HTMLDivElement>(null);

  function nudge(event: KeyboardEvent<HTMLButtonElement>, field: LayoutField) {
    const step = event.shiftKey ? 5 : 1;
    const dx = event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0;
    const dy = event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0;
    if (dx === 0 && dy === 0) return;
    event.preventDefault();
    if (props.readOnly) return;
    if (event.altKey) {
      props.onCommit(field.id, {
        w: clamp(field.w + dx, 5, PAGE.width - field.x),
        h: clamp(field.h + dy, 3, PAGE.height - field.y),
      });
    } else {
      props.onCommit(field.id, {
        x: clamp(field.x + dx, 0, PAGE.width - field.w),
        y: clamp(field.y + dy, 0, PAGE.height - field.h),
      });
    }
  }

  function start(event: PointerEvent<HTMLElement>, field: LayoutField, mode: 'move' | 'resize') {
    props.onSelect(field.id);
    if (props.readOnly || !page.current) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      id: field.id,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      origin: field,
      unitPx: page.current.getBoundingClientRect().width / PAGE.width,
      moved: false,
    };
  }

  function move(event: PointerEvent<HTMLElement>) {
    const state = drag.current;
    if (!state) return;
    const dx = (event.clientX - state.startX) / state.unitPx;
    const dy = (event.clientY - state.startY) / state.unitPx;
    state.moved = true;
    props.onLive(state.id, patchOf(state.mode, state.origin, dx, dy));
  }

  function end(event: PointerEvent<HTMLElement>) {
    const state = drag.current;
    drag.current = null;
    if (!state?.moved) return;
    const dx = (event.clientX - state.startX) / state.unitPx;
    const dy = (event.clientY - state.startY) / state.unitPx;
    props.onCommit(state.id, patchOf(state.mode, state.origin, dx, dy));
  }

  return (
    <div
      ref={page}
      data-testid="certificate-page"
      className="relative w-full overflow-hidden border bg-white shadow-sm"
      style={{ aspectRatio: `${PAGE.width} / ${PAGE.height}`, containerType: 'inline-size' }}
    >
      {props.backgroundMediaId ? (
        <img
          src={signatureSrc(props.backgroundMediaId)}
          alt=""
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
        />
      ) : null}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          border: `${(FRAME_MM / PAGE.width) * 100}cqw solid #1f3a5f`,
          boxSizing: 'border-box',
        }}
      />
      {FIELD_IDS.map((id) => {
        const field = props.layout.fields.find((item) => item.id === id);
        if (!field) return null;
        const isSelected = props.selected === id;
        const label = `${FIELD_LABELS[id]}: ${field.x} mm da esquerda, ${field.y} mm do topo, ${field.w} por ${field.h} mm. ${props.readOnly ? '' : 'Setas movem, Shift move 5 mm, Alt redimensiona.'}`;
        const text = isTextField(id) ? (props.samples[id] ?? '') : '';
        const fit = isTextField(id) ? fitFontSize(text, field) : null;
        return (
          <button
            key={id}
            type="button"
            aria-label={label}
            aria-pressed={isSelected}
            data-field={id}
            onClick={() => props.onSelect(id)}
            onFocus={() => props.onSelect(id)}
            onKeyDown={(event) => nudge(event, field)}
            onPointerDown={(event) => start(event, field, 'move')}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={() => {
              drag.current = null;
            }}
            className={`absolute m-0 overflow-hidden border p-0 text-left ${
              isSelected
                ? 'border-2 border-[var(--focus-ring)]'
                : 'border border-dashed border-slate-400'
            } ${props.problemIds.has(id) ? 'bg-amber-100/60' : 'bg-transparent'}`}
            style={{
              ...boxStyle(field),
              touchAction: 'none',
              // WCAG 2.5.8: alvo de pelo menos 24 px mesmo quando a caixa em mm fica pequena na tela.
              minWidth: '24px',
              minHeight: '24px',
              cursor: props.readOnly ? 'default' : 'move',
              ...(fit
                ? {
                    fontSize: `${fit.fontSize * PT_TO_CQW}cqw`,
                    fontWeight: field.weight,
                    color: field.color,
                    textAlign: field.align,
                    lineHeight: 1.25,
                    whiteSpace: 'pre-line',
                    overflowWrap: 'anywhere',
                    fontFamily: "'Lexend Deca Variable', 'Lexend Deca', system-ui, sans-serif",
                  }
                : {}),
            }}
          >
            {id === 'signature' ? (
              props.signatureMediaId ? (
                <img
                  src={signatureSrc(props.signatureMediaId)}
                  alt=""
                  className="pointer-events-none h-full w-full object-contain"
                />
              ) : (
                <span className="text-[1.4cqw] text-slate-500">Assinatura</span>
              )
            ) : id === 'qr' ? (
              <span
                className="grid h-full w-full place-items-center bg-slate-900 text-[1.6cqw] text-white"
                aria-hidden="true"
              >
                QR
              </span>
            ) : (
              <span aria-hidden="true">{text}</span>
            )}
            {isSelected && !props.readOnly ? (
              <span
                aria-hidden="true"
                data-resize={id}
                onPointerDown={(event) => start(event, field, 'resize')}
                onPointerMove={move}
                onPointerUp={end}
                className="absolute bottom-0 right-0 h-3 w-3 cursor-nwse-resize bg-[var(--focus-ring)]"
                style={{ touchAction: 'none' }}
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function patchOf(
  mode: 'move' | 'resize',
  origin: LayoutField,
  dx: number,
  dy: number,
): Partial<LayoutField> {
  if (mode === 'resize') {
    return {
      w: clamp(round(origin.w + dx), 5, PAGE.width - origin.x),
      h: clamp(round(origin.h + dy), 3, PAGE.height - origin.y),
    };
  }
  return {
    x: clamp(round(origin.x + dx), 0, PAGE.width - origin.w),
    y: clamp(round(origin.y + dy), 0, PAGE.height - origin.h),
  };
}
