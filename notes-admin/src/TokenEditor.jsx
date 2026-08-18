import { useId, useState } from 'react';

export default function TokenEditor({ label, values, suggestions = [], onChange, placeholder = '', max = 20 }) {
  const [input, setInput] = useState('');
  const listId = useId();
  const currentValues = Array.isArray(values) ? values : [];
  const add = raw => {
    const additions = String(raw).split(/[,、]/).map(value => value.trim().replace(/^#/, '')).filter(Boolean);
    if (!additions.length) return;
    onChange([...new Set([...currentValues, ...additions])].slice(0, max)); setInput('');
  };
  const remove = value => onChange(currentValues.filter(item => item !== value));
  const keyDown = event => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); add(input); }
    else if (event.key === 'Backspace' && !input && currentValues.length) remove(currentValues.at(-1));
  };
  const paste = event => {
    const text = event.clipboardData?.getData('text') || '';
    if (/[、,]/.test(text)) { event.preventDefault(); add(text); }
  };
  return <div className="token-field">
    <span className="token-label">{label} <small>{currentValues.length}/{max}</small></span>
    <div className="token-editor">
      {currentValues.map(value => <span className="token" key={value}>{label === 'TAGS' ? '#' : ''}{value}<button type="button" aria-label={`${value}を削除`} onClick={() => remove(value)}>×</button></span>)}
      <input value={input} list={listId} placeholder={currentValues.length ? '追加…' : placeholder} aria-label={`${label}を追加`} onChange={event => setInput(event.target.value)} onKeyDown={keyDown} onPaste={paste} onBlur={() => add(input)}/>
      <button type="button" className="token-add" disabled={!input.trim()} onMouseDown={event => event.preventDefault()} onClick={() => add(input)}>ADD</button>
      <datalist id={listId}>{suggestions.filter(value => !currentValues.includes(value)).map(value => <option value={value} key={value}/>)}</datalist>
    </div>
    <small className="token-help">Enter / comma / 「、」で複数追加</small>
  </div>;
}
