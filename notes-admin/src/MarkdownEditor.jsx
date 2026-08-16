import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { autocompletion, startCompletion } from '@codemirror/autocomplete';
import { markdown } from '@codemirror/lang-markdown';

export default function MarkdownEditor({ value, onChange, notes, onPublish }) {
  const host = useRef(null);
  const viewRef = useRef(null);
  const publishRef = useRef(onPublish);
  publishRef.current = onPublish;

  useEffect(() => {
    const source = context => {
      const before = context.matchBefore(/\[\[[^\]\n]*/);
      if (!before) return null;
      const query = before.text.slice(2).normalize('NFKC').toLocaleLowerCase('ja');
      const options = notes
        .filter(note => !query || [note.slug, note.title, ...(note.aliases || [])].join(' ').normalize('NFKC').toLocaleLowerCase('ja').includes(query))
        .slice(0, 12)
        .map(note => ({ label: note.title, detail: note.slug, apply: `${note.title}]]` }));
      return { from: before.from + 2, options, validFor: /^[^\]\n]*$/ };
    };
    const updateListener = EditorView.updateListener.of(update => {
      if (!update.docChanged) return;
      onChange(update.state.doc.toString());
      const cursor = update.state.selection.main.head;
      const tail = update.state.sliceDoc(Math.max(0, cursor - 100), cursor);
      if (/\[\[[^\]\n]*$/.test(tail)) queueMicrotask(() => startCompletion(update.view));
    });
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(), markdown(), autocompletion({ override: [source], activateOnTyping: true }),
          placeholder('本文を書く。[[ で別の記事につなぐ。'),
          keymap.of([{ key: 'Mod-Enter', run: editor => { if (!editor.composing) publishRef.current(); return true; } }, ...defaultKeymap, ...historyKeymap]),
          updateListener, EditorView.lineWrapping
        ]
      })
    });
    viewRef.current = view;
    return () => view.destroy();
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (view && view.state.doc.toString() !== value) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
  }, [value]);

  return <div className="editor-host" ref={host} />;
}
