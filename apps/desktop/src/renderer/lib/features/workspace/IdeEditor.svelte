<script lang="ts">
  import {untrack} from 'svelte';
  import {EditorView, keymap, lineNumbers, drawSelection} from '@codemirror/view';
  import {Compartment, EditorSelection, EditorState} from '@codemirror/state';
  import {defaultKeymap, history, historyKeymap, indentWithTab} from '@codemirror/commands';
  import {HighlightStyle, indentUnit, syntaxHighlighting} from '@codemirror/language';
  import {tags} from '@lezer/highlight';
  import {languageExtension} from './ideHighlight';

  type Props = {
    name: string;
    language: string;
    fileName: string;
    content: string;
    cursorLine: number;
    cursorColumn: number;
    onChange: (content: string, line: number, column: number) => void;
  };

  let {name, language, fileName, content, cursorLine, cursorColumn, onChange}: Props = $props();

  const highlightStyle = HighlightStyle.define([
    {tag: tags.comment, class: 'ide-tok-comment'},
    {tag: tags.lineComment, class: 'ide-tok-comment'},
    {tag: tags.blockComment, class: 'ide-tok-comment'},
    {tag: tags.docComment, class: 'ide-tok-comment'},
    {tag: tags.keyword, class: 'ide-tok-keyword'},
    {tag: tags.controlKeyword, class: 'ide-tok-keyword'},
    {tag: tags.moduleKeyword, class: 'ide-tok-keyword'},
    {tag: tags.definitionKeyword, class: 'ide-tok-keyword'},
    {tag: tags.operatorKeyword, class: 'ide-tok-keyword'},
    {tag: tags.atom, class: 'ide-tok-atom'},
    {tag: tags.bool, class: 'ide-tok-atom'},
    {tag: tags.null, class: 'ide-tok-atom'},
    {tag: tags.number, class: 'ide-tok-number'},
    {tag: tags.float, class: 'ide-tok-number'},
    {tag: tags.integer, class: 'ide-tok-number'},
    {tag: tags.string, class: 'ide-tok-string'},
    {tag: tags.special(tags.string), class: 'ide-tok-string'},
    {tag: tags.character, class: 'ide-tok-string'},
    {tag: tags.regexp, class: 'ide-tok-regexp'},
    {tag: tags.escape, class: 'ide-tok-regexp'},
    {tag: tags.typeName, class: 'ide-tok-type'},
    {tag: tags.className, class: 'ide-tok-type'},
    {tag: tags.namespace, class: 'ide-tok-type'},
    {tag: tags.macroName, class: 'ide-tok-type'},
    {tag: tags.function(tags.variableName), class: 'ide-tok-function'},
    {tag: tags.definition(tags.variableName), class: 'ide-tok-function'},
    {tag: tags.propertyName, class: 'ide-tok-property'},
    {tag: tags.attributeName, class: 'ide-tok-property'},
    {tag: tags.attributeValue, class: 'ide-tok-string'},
    {tag: tags.tagName, class: 'ide-tok-tag'},
    {tag: tags.angleBracket, class: 'ide-tok-tag'},
    {tag: tags.operator, class: 'ide-tok-operator'},
    {tag: tags.compareOperator, class: 'ide-tok-operator'},
    {tag: tags.logicOperator, class: 'ide-tok-operator'},
    {tag: tags.punctuation, class: 'ide-tok-punctuation'},
    {tag: tags.separator, class: 'ide-tok-punctuation'},
    {tag: tags.heading, class: 'ide-tok-heading'},
    {tag: tags.strong, class: 'ide-tok-heading'},
    {tag: tags.emphasis, class: 'ide-tok-heading'},
    {tag: tags.link, class: 'ide-tok-link'},
    {tag: tags.url, class: 'ide-tok-link'},
    {tag: tags.meta, class: 'ide-tok-meta'},
    {tag: tags.processingInstruction, class: 'ide-tok-meta'},
    {tag: tags.invalid, class: 'ide-tok-invalid'},
  ]);

  const editorTheme = EditorView.theme({
    '&': {
      height: '100%',
      background: 'transparent',
      color: 'var(--neutral-950)',
      fontSize: '12.5px',
    },
    '&.cm-focused': {outline: 'none'},
    '.cm-scroller': {
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      lineHeight: '1.55',
      overflow: 'auto',
      scrollbarWidth: 'none',
    },
    '.cm-scroller::-webkit-scrollbar': {display: 'none'},
    '.cm-gutters': {
      background: 'transparent',
      border: 'none',
      color: 'var(--neutral-400)',
      minWidth: '3.2em',
    },
    '.cm-lineNumbers .cm-gutterElement': {
      padding: '0 8px 0 12px',
      minWidth: '3.2em',
    },
    '.cm-content': {
      caretColor: 'var(--neutral-950)',
      padding: '10px 14px 10px 8px',
      fontFamily: 'inherit',
    },
    // The shared contenteditable focus ring would draw a full-height line here.
    '.cm-content:focus-visible': {outline: 'none'},
    '.cm-line': {padding: '0'},
    '.cm-cursor, .cm-dropCursor': {borderLeftColor: 'var(--neutral-950)'},
    '.cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
      background: 'var(--neutral-200)',
    },
    '.cm-activeLine, .cm-activeLineGutter': {background: 'transparent'},
  });

  function cursorPos(state: EditorState, line: number, column: number): number {
    const safeLine = Math.min(Math.max(line, 1), state.doc.lines);
    const info = state.doc.line(safeLine);
    return info.from + Math.min(Math.max(column - 1, 0), info.length);
  }

  function attachEditor(node: HTMLDivElement): () => void {
    // Initial selection dispatch calls onChange synchronously. Its parent-state
    // reads must not make this attachment recreate the editor on every edit.
    return untrack(() => createEditor(node));
  }

  function createEditor(node: HTMLDivElement): () => void {
    const start = {
      name,
      language,
      fileName,
      content,
      cursorLine,
      cursorColumn,
    };
    const languageCompartment = new Compartment();
    let view: EditorView | undefined;
    let cancelled = false;
    const state = EditorState.create({
      doc: start.content,
      extensions: [
        lineNumbers(),
        drawSelection(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        indentUnit.of('  '),
        EditorState.tabSize.of(2),
        syntaxHighlighting(highlightStyle),
        editorTheme,
        languageCompartment.of([]),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged && !update.selectionSet) return;
          const head = update.state.selection.main.head;
          const line = update.state.doc.lineAt(head);
          onChange(update.state.doc.toString(), line.number, head - line.from + 1);
        }),
        EditorView.contentAttributes.of({
          'aria-label': start.name,
          role: 'textbox',
          spellcheck: 'false',
          autocapitalize: 'off',
          autocorrect: 'off',
        }),
      ],
    });
    view = new EditorView({state, parent: node});
    const pos = cursorPos(view.state, start.cursorLine, start.cursorColumn);
    view.dispatch({selection: EditorSelection.cursor(pos), scrollIntoView: true});
    void languageExtension(start.language, start.fileName).then((languageExt) => {
      if (cancelled || !view) return;
      view.dispatch({effects: languageCompartment.reconfigure(languageExt)});
    });
    return () => {
      cancelled = true;
      view?.destroy();
    };
  }
</script>

<div class="ide-editor-host" {@attach attachEditor}></div>

<style>
  .ide-editor-host {
    min-width: 0;
    min-height: 0;
    flex: 1;
    display: flex;
    overflow: hidden;
  }
  .ide-editor-host :global(.cm-editor) {
    width: 100%;
    height: 100%;
  }
  .ide-editor-host :global(.ide-tok-comment) { color: var(--neutral-500); }
  .ide-editor-host :global(.ide-tok-keyword) { color: var(--link-text); }
  .ide-editor-host :global(.ide-tok-atom) { color: var(--link-text); }
  .ide-editor-host :global(.ide-tok-number) { color: var(--warning-text); }
  .ide-editor-host :global(.ide-tok-string) { color: var(--status-success-text); }
  .ide-editor-host :global(.ide-tok-regexp) { color: var(--warning-text); }
  .ide-editor-host :global(.ide-tok-type) { color: var(--link-text); }
  .ide-editor-host :global(.ide-tok-function) { color: var(--neutral-950); }
  .ide-editor-host :global(.ide-tok-property) { color: var(--neutral-800); }
  .ide-editor-host :global(.ide-tok-tag) { color: var(--link-text); }
  .ide-editor-host :global(.ide-tok-operator) { color: var(--neutral-700); }
  .ide-editor-host :global(.ide-tok-punctuation) { color: var(--neutral-700); }
  .ide-editor-host :global(.ide-tok-heading) { color: var(--neutral-950); font-weight: 560; }
  .ide-editor-host :global(.ide-tok-link) { color: var(--link-text); }
  .ide-editor-host :global(.ide-tok-meta) { color: var(--neutral-600); }
  .ide-editor-host :global(.ide-tok-invalid) { color: var(--status-error-text); }
</style>
