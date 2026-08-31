import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { EditorState, Transaction } from '@codemirror/state';
import { Decoration, EditorView, keymap, placeholder, ViewPlugin, WidgetType } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, redo, undo } from '@codemirror/commands';
import { autocompletion, closeBrackets, closeBracketsKeymap, startCompletion } from '@codemirror/autocomplete';
import { markdown } from '@codemirror/lang-markdown';
import { openSearchPanel, search, searchKeymap } from '@codemirror/search';
import { changeHeadingLevel, changeLineDepth, continueMarkdownBlock, hierarchyDepthAt, imageMarkdownRanges, noteCompletionOptions, selectionSupportsHierarchyTab, slashCommandOptions } from './editorTools.js';

const searchPhrases = EditorState.phrases.of({
  Find: '本文を検索',
  Replace: '置換後の文字',
  next: '次へ',
  previous: '前へ',
  all: 'すべて選択',
  'match case': '大文字小文字',
  regexp: '正規表現',
  'by word': '単語単位',
  replace: '置換',
  'replace all': 'すべて置換',
  close: '閉じる'
});

const slashCompletionOptions = slashCommandOptions().map(command => ({
  label: command.label,
  detail: command.detail,
  type: 'keyword',
  apply: (view, _completion, from, to) => {
    const anchor = from + command.cursorOffset;
    view.dispatch({
      changes: { from, to, insert: command.insert },
      selection: { anchor },
      scrollIntoView: true,
      annotations: Transaction.userEvent.of('input.complete')
    });
  }
}));

class ImageMarkdownWidget extends WidgetType {
  constructor(range) {
    super();
    this.range = range;
  }

  eq(other) {
    return this.range.from === other.range.from && this.range.to === other.range.to && this.range.index === other.range.index && this.range.alt === other.range.alt;
  }

  toDOM(view) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cm-image-token';
    button.dataset.imageFrom = String(this.range.from);
    button.setAttribute('aria-label', `画像${this.range.index}のMarkdownを編集`);
    const label = document.createElement('span');
    label.textContent = `IMAGE ${String(this.range.index).padStart(2, '0')}`;
    const action = document.createElement('small');
    action.textContent = this.range.alt ? `${this.range.alt} / EDIT` : 'EDIT MARKDOWN';
    button.append(label, action);
    const activate = event => {
      event.preventDefault();
      revealImageMarkdownAt(this.range.from, view);
    };
    button.addEventListener('click', activate);
    button.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') activate(event);
    });
    return button;
  }

  ignoreEvent() {
    return true;
  }
}

function imageMarkdownDecorations(view) {
  const selection = view.state.selection.main;
  const cursor = selection.head;
  const ranges = imageMarkdownRanges(view.state.doc.toString()).flatMap(range => {
    const selected = selection.from !== selection.to
      ? selection.from < range.to && selection.to > range.from
      : cursor > range.from && cursor < range.to;
    return selected ? [] : [Decoration.replace({ widget: new ImageMarkdownWidget(range) }).range(range.from, range.to)];
  });
  return Decoration.set(ranges, true);
}

const imageMarkdownPlugin = ViewPlugin.fromClass(class {
  constructor(view) {
    this.decorations = imageMarkdownDecorations(view);
  }

  update(update) {
    if (update.docChanged || update.selectionSet || update.viewportChanged) this.decorations = imageMarkdownDecorations(update.view);
  }
}, { decorations: instance => instance.decorations });

function revealImageMarkdownAt(from, view) {
  view.dispatch({ selection: { anchor: Math.min(from + 2, view.state.doc.length) }, scrollIntoView: true });
  view.focus();
}

function shouldStartCompletion(tail) {
  return /\[\[[^\]\n]*$/.test(tail) || /(?:^|\n)[ \t]*\/[a-z0-9-]*$/i.test(tail);
}

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
  else if (command === 'search') openSearchPanel(view);
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
    resetScroll: () => {
      const view = viewRef.current; if (!view) return;
      view.scrollDOM.scrollTop = 0; view.scrollDOM.scrollLeft = 0;
    },
    goToLine: lineNumber => {
      const view = viewRef.current; if (!view) return;
      const line = view.state.doc.line(Math.max(1, Math.min(lineNumber, view.state.doc.lines)));
      view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'center' }) }); view.focus();
    }
  }), []);

  useEffect(() => {
    const wikilinkSource = context => {
      if (context.view?.composing) return null;
      const before = context.matchBefore(/\[\[[^\]\n]*/);
      if (!before) return null;
      const options = noteCompletionOptions(notesRef.current, before.text.slice(2));
      return { from: before.from + 2, options, validFor: /^[^\]\n]*$/ };
    };
    const slashSource = context => {
      if (context.view?.composing) return null;
      const line = context.state.doc.lineAt(context.pos);
      const before = context.state.sliceDoc(line.from, context.pos);
      const match = before.match(/^([ \t]*)\/[a-z0-9-]*$/i);
      if (!match) return null;
      return { from: line.from + match[1].length, options: slashCompletionOptions, validFor: /^\/[a-z0-9-]*$/i };
    };
    const updateListener = EditorView.updateListener.of(update => {
      if (update.docChanged) changeRef.current(update.state.doc.toString());
      if (update.docChanged || update.selectionSet) {
        depthRef.current?.(hierarchyDepthAt(update.state.doc.toString(), update.state.selection.main.head));
      }
      if (!update.docChanged || update.view.composing) return;
      const cursor = update.state.selection.main.head;
      const tail = update.state.sliceDoc(Math.max(0, cursor - 100), cursor);
      if (shouldStartCompletion(tail)) queueMicrotask(() => startCompletion(update.view));
    });
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(), markdown(), imageMarkdownPlugin, closeBrackets(), autocompletion({ override: [wikilinkSource, slashSource], activateOnTyping: true }),
          search({ top: true }), searchPhrases,
          placeholder('本文を書く。[[ で別の記事につなぐ。'),
          keymap.of([
            { key: 'Mod-Enter', run: editor => { if (!editor.composing) publishRef.current(); return true; } },
            { key: 'Mod-b', run: editor => { runCommand(editor, 'bold'); return true; } },
            { key: 'Mod-k', run: editor => { runCommand(editor, 'link'); return true; } },
            { key: 'Mod-Shift-k', run: editor => { runCommand(editor, 'wikilink'); return true; } },
            { key: 'Tab', run: editor => { const selection = editor.state.selection.main; if (editor.composing || !selectionSupportsHierarchyTab(editor.state.doc.toString(), selection.from, selection.to)) return false; runCommand(editor, 'indent'); return true; } },
            { key: 'Shift-Tab', run: editor => { const selection = editor.state.selection.main; if (editor.composing || !selectionSupportsHierarchyTab(editor.state.doc.toString(), selection.from, selection.to)) return false; runCommand(editor, 'outdent'); return true; } },
            { key: 'Mod-]', run: editor => { runCommand(editor, 'indent'); return true; } },
            { key: 'Mod-[', run: editor => { runCommand(editor, 'outdent'); return true; } },
            { key: 'Enter', run: editor => editor.composing ? false : continueMarkdownBlock(editor) },
            ...searchKeymap, ...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap
          ]),
          EditorView.domEventHandlers({
            compositionend: (_event, view) => { const cursor = view.state.selection.main.head; const tail = view.state.sliceDoc(Math.max(0, cursor - 100), cursor); if (shouldStartCompletion(tail)) queueMicrotask(() => startCompletion(view)); return false; },
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
    if (view && view.state.doc.toString() !== value) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value }, annotations: Transaction.addToHistory.of(false) });
      view.scrollDOM.scrollTop = 0; view.scrollDOM.scrollLeft = 0;
    }
  }, [value]);

  return <div className="editor-host" ref={host} />;
});

export default MarkdownEditor;
