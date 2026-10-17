// Small building blocks shared by the mobile screens: page headers, modal headers, form fields and empty states.
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../lib/util.js';
import { actions } from '../lib/store.js';

/** Screen title. `title` may contain a highlighted word: pass JSX. */
export const PageHead = ({ title, sub, right = null }) => (
  <header className="ph"><div><h1>{title}</h1>{sub ? <p>{sub}</p> : null}</div>{right}</header>
);
export const SecHead = ({ title, more = null }) => <div className="sechead"><h3 className="sech">{title}</h3>{more}</div>;

/** Modal header: grab handle, title, close (or back) button. */
export function ModalHead({ title, onClose = actions.closeModal, back = false, hiddenTitle = false }) {
  return (
    <div className="mhead"><span className="gr" />
      <h2 id="ovTitle" className={hiddenTitle ? 'vh' : undefined}>{title}</h2>
      {hiddenTitle ? <span /> : null}
      <button className="iconbtn" type="button" onClick={onClose} aria-label={back ? 'Back' : 'Close'}><Icon n={back ? 'back' : 'x'} /></button>
    </div>
  );
}

/** A labelled form field with its error message (the `.f` / `.ferr` markup the styles expect). */
export function Field({ k, label, error, children, hidden, id }) {
  return (
    <label className={'f' + (error ? ' invalid' : '')} data-f={k} hidden={hidden} id={id}>
      <span>{label}</span>{children}<em className="ferr" hidden={!error}>{error}</em>
    </label>
  );
}

export const Empty = ({ icon, title, text, children }) => (
  <div className="empty">{icon ? <div className="glyph"><Icon n={icon} /></div> : null}{title ? <b>{title}</b> : null}{text ? <span>{text}</span> : null}{children}</div>
);

/** Scroll the first invalid field (or the form error) into view whenever errors change. */
export function useScrollToError(errors, formErr) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    const first = ref.current.querySelector('.f.invalid') || (formErr ? ref.current.querySelector('.formerr') : null);
    first?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [errors, formErr]);
  return ref;
}

/** Hidden field that only bots fill in. */
export const Honeypot = ({ value, onChange }) => (
  <input type="text" tabIndex={-1} autoComplete="off" className="vh" aria-hidden="true" value={value} onChange={(e) => onChange(e.target.value)} />
);

/** Two-tap confirmation button ("Tap again to …"). */
export function ConfirmButton({ className, onConfirm, children, confirmLabel, disabled, style }) {
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" className={className} style={style} disabled={disabled || busy} onClick={async () => {
      if (!sure) { setSure(true); return; }
      setBusy(true);
      try { await onConfirm(); } finally { setBusy(false); }
    }}>{sure ? confirmLabel : children}</button>
  );
}
