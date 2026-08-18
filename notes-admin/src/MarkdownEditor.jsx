import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, redo, undo } from '@codemirror/commands';
import { autocompletion, closeBrackets, closeBracketsKeymap, startCompletion } from '@codemirror/autocomplete';
import { markdown } from '@codemirror/lang-markdown';
import { changeHeadingLevel, changeLineDepth, continueMarkdownBlock, hierarchyDepthAt } from './editorTools.js';

function replaceSelection(view, before, after = before, placeholderText = '') {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to) || placeholderText;
  const insert = `${before}${selected}${after}`;
  view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + before.length, head: from + before.length + selected.length }, scrollIntoView: true });
  view.focus();
}

function prefixLines(view, prefix) {
  const { from, to } = view.state.selection.main;
  const start = view.state.doc.lineAt(from).from;
  const end = view.state.doc.lineAt(to).to;
  const selected = view.state.sliceDoc(start, end);
  const insert = selected.split('\n').map((line, index) => typeof prefix === 'function' ? prefix(line, index) : `${prefix}${line}`).join('\n');
  view.dispatch({ changes: { from: start, to: end, insert }, selection: { anchor: start, head: start + insert.length }, scrollIntoView: true });
  view.focus();
}

function insertText(view, text) {
  if (!view) return;
  const { from, to } = view.state.selection.main;
  view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length }, scrollIntoView: true });
  view.focus();
}

function applyLineTransform(view, transform) {
  if (!view) return;
  const { from, to } = view.state.selection.main;
  const result = transform(view.state.doc.toString(), from, to);
  if (result.insert === view.state.sliceDoc(result.from, result.end)) {
    view.focus();
    return;
  }
  view.dispatch({
    changes: { from: result.from, to: result.end, insert: result.insert },
    selection: { anchor: result.from, head: result.to },
    scrollIntoView: true
  });
  view.focus();
}

function runCommand(view, command) {
  if (!view) return;
  if (command === 'h2') prefixLines(view, '## ');
  else if (command === 'h3') prefixLines(view, '### ');
  else if (command === 'indent') applyLineTransform(view, (source, from, to) => changeLineDepth(source, from, to, 1));
  else if (command === 'outdent') applyLineTransform(view, (source, from, to) => changeLineDepth(source, from, to, -1));
  else if (command === 'headingUp') applyLineTransform(view, (source, from, to) => changeHeadingLevel(source, from, to, 1));
  else if (command === 'headingDown') applyLineTransform(view, (source, from, to) => changeHeadingLevel(source, from, to, -1));
  else if (command === 'bold') replaceSelection(view, '**', '**', '太字');
  else if (command === 'link') replaceSelection(view, '[', '](https://)', 'リンク');
  else if (command === 'wikilink') replaceSelection(view, '[[', ']]', '記事名');
  else if (command === 'quote') prefixLines(view, '> ');
  else if (command === 'bullet') prefixLines(view, '- ');
  else if (command === 'ordered') prefixLines(view, (line, index) => `${index + 1}. ${line}`);
  else if (command === 'task') prefixLines(view, '- [ ] ');
  else if (command === 'code') {
    const { from, to } = view.state.selection.main; const selected = view.state.sliceDoc(from, to);
    replaceSelection(view, selected.includes('\n') ? '```\n' : '`', selected.includes('\n') ? '\n```' : '`', 'code');
  } else if (command === 'divider') replaceSelection(view, '\n\n---\n\n', '', '');
  else if (command === 'undo') undo(view);
  else if (command === 'redo') redo(view);
}

const MarkdownEditor = forwardRef(function MarkdownEditor({ value, onChange, notes, onPublish, onFiles, onDepthChange }, forwardedRef) {
  const host = useRef(null);
  const viewRef = useRef(null);
  const publishRef = useRef(onPublish);
  const changeRef = useRef(onChange);
  const filesRef = useRef(onFiles);
  const notesRef = useRef(notes);
  const depthRef = useRef(onDepthChange);
  publishRef.current = onPublish;
  changeRef.current = onChange;
  filesRef.current = onFiles;
  notesRef.current = notes;
  depthRef.current = onDepthChange;

  useImperativeHandle(forwardedRef, () => ({
    command: command => runCommand(viewRef.current, command),
    insertMarkdown: text => insertText(viewRef.current, text),
    focus: () => viewRef.current?.focus(),
    goToLine: lineNumber => {
      const view = viewRef.current; if (!view) return;
      const line = view.state.doc.line(Math.max(1, Math.min(lineNumber, view.state.doc.lines)));
      view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'center' }) }); view.focus();
    }
  }), []);

  useEffect(() => {
    const source = context => {
      const before = context.matchBefore(/\[\[[^\]\n]*/);
      if (!before) return null;
      const query = before.text.slice(2).normalize('NFKC').toLocaleLowerCase('ja');
      const options = notesRef.current
        .filter(note => !query || [note.slug, note.title, ...(note.aliases || [])].join(' ').normalize('NFKC').toLocaleLowerCase('ja').includes(query))
        .slice(0, 12)
        .map(note => ({ label: note.title, detail: note.slug, apply: `${note.title}]]` }));
      return { from: before.from + 2, options, validFor: /^[^\]\n]*$/ };
    };
    const updateListener = EditorView.updateListener.of(update => {
      if (update.docChanged) changeRef.current(update.state.doc.toString());
      if (update.docChanged || update.selectionSet) {
        depthRef.current?.(hierarchyDepthAt(update.state.doc.toString(), update.state.selection.main.head));
      }
      if (!update.docChanged) return;
      const cursor = update.state.selection.main.head;
      const tail = update.state.sliceDoc(Math.max(0, cursor - 100), cursor);
      if (/\[\[[^\]\n]*$/.test(tail)) queueMicrotask(() => startCompletion(update.view));
    });
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(), markdown(), closeBrackets(), autocompletion({ override: [source], activateOnTyping: true }),
          placeholder('本文を書く。[[ で別の記事につなぐ。'),
          keymap.of([
            { key: 'Mod-Enter', run: editor => { if (!editor.composing) publishRef.current(); return true; } },
            { key: 'Mod-b', run: editor => { runCommand(editor, 'bold'); return true; } },
            { key: 'Mod-k', run: editor => { runCommand(editor, 'link'); return true; } },
            { key: 'Mod-Shift-k', run: editor => { runCommand(editor, 'wikilink'); return true; } },
            { key: 'Tab', run: editor => { runCommand(editor, 'indent'); return true; } },
            { key: 'Shift-Tab', run: editor => { runCommand(editor, 'outdent'); return true; } },
            { key: 'Mod-]', run: editor => { runCommand(editor, 'indent'); return true; } },
            { key: 'Mod-[', run: editor => { runCommand(editor, 'outdent'); return true; } },
            { key: 'Enter', run: editor => continueMarkdownBlock(editor) },
            ...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap
          ]),
          EditorView.domEventHandlers({
            paste: event => { const files = [...(event.clipboardData?.files || [])].filter(file => file.type.startsWith('image/') || /\.(?:heic|heif|jpe?g|png|gif|webp|avif|bmp|svg)$/i.test(file.name)); if (!files.length) return false; event.preventDefault(); filesRef.current?.(files); return true; },
            drop: event => { const files = [...(event.dataTransfer?.files || [])].filter(file => file.type.startsWith('image/') || /\.(?:heic|heif|jpe?g|png|gif|webp|avif|bmp|svg)$/i.test(file.name)); if (!files.length) return false; event.preventDefault(); filesRef.current?.(files); return true; }
          }),
          updateListener, EditorView.lineWrapping
        ]
      })
    });
    viewRef.current = view;
    depthRef.current?.(hierarchyDepthAt(value, 0));
    return () => view.destroy();
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (view && view.state.doc.toString() !== value) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
  }, [value]);

  return <div className="editor-host" ref={host} />;
});

export default MarkdownEditor;
