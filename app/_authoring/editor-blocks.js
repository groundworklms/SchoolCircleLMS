'use client';

import { createAuthoringId, duplicateWithFreshIds, moveArrayItem } from './editor-pure.mjs';
import { ArrayControls, IconButton, TextField } from './editor-shared';

export function ObjectiveEditor({ objectives, onChange, disabled }) {
  const change = (index, value) => {
    const next = objectives.slice();
    next[index] = value;
    onChange(next);
  };
  return (
    <div className="authoring-array-section">
      <div className="authoring-array-heading">
        <div>
          <h3>Objectives</h3>
          <p className="authoring-muted">What should learners be able to do after this course?</p>
        </div>
        <button type="button" className="authoring-btn ghost small" onClick={() => onChange([...objectives, ''])} disabled={disabled}>Add objective</button>
      </div>
      {objectives.length === 0 && <p className="authoring-muted authoring-empty-line">No objectives yet.</p>}
      <div className="authoring-objectives">
        {objectives.map((objective, index) => (
          <div className="authoring-objective-row" key={`objective-${index}`}>
            <span className="authoring-drag-number">{index + 1}</span>
            <input
              aria-label={`Objective ${index + 1}`}
              value={objective}
              onChange={(event) => change(index, event.target.value)}
              disabled={disabled}
              placeholder="Learner will be able to…"
              maxLength={500}
            />
            <div className="authoring-array-controls" aria-label={`Objective ${index + 1} controls`}>
              <IconButton label="Move objective up" onClick={() => onChange(moveArrayItem(objectives, index, -1))} disabled={disabled || index === 0}>↑</IconButton>
              <IconButton label="Move objective down" onClick={() => onChange(moveArrayItem(objectives, index, 1))} disabled={disabled || index === objectives.length - 1}>↓</IconButton>
              <IconButton label="Delete objective" onClick={() => onChange(objectives.filter((_, itemIndex) => itemIndex !== index))} disabled={disabled} danger>×</IconButton>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export const BLOCK_TYPES = [
  ['text', 'Text'],
  ['image', 'Image'],
  ['video', 'Video'],
  ['attachment', 'Attachment'],
  ['accordion', 'Accordion'],
  ['flashcards', 'Flashcards'],
  ['hotspots', 'Image hotspots'],
  ['check', 'Knowledge check'],
  ['scenario', 'Scenario'],
];

export function BlockEditor({ block, index, total, onChange, onDelete, onMove, onDuplicate, disabled }) {
  const patch = (changes) => onChange({ ...block, ...changes });
  const typeLabel = BLOCK_TYPES.find(([value]) => value === block.type)?.[1] || block.type;

  const renderNestedRows = (items, key, renderItem, makeItem, singular) => (
    <div className="authoring-nested-section">
      <div className="authoring-nested-heading">
        <h4>{singular}</h4>
        <button type="button" className="authoring-btn ghost small" onClick={() => patch({ [key]: [...items, makeItem()] })} disabled={disabled}>
          Add {singular.toLowerCase()}
        </button>
      </div>
      {items.length === 0 && <p className="authoring-muted authoring-empty-line">No {singular.toLowerCase()} items yet.</p>}
      {items.map((item, itemIndex) => (
        <div className="authoring-nested-card" key={item.id || `${key}-${itemIndex}`}>
          {renderItem(item, itemIndex)}
          <ArrayControls
            index={itemIndex}
            length={items.length}
            onMove={(offset) => patch({ [key]: moveArrayItem(items, itemIndex, offset) })}
            onDuplicate={() => {
              const copied = duplicateWithFreshIds(item);
              patch({ [key]: [...items.slice(0, itemIndex + 1), copied, ...items.slice(itemIndex + 1)] });
            }}
            onDelete={() => patch({ [key]: items.filter((_, currentIndex) => currentIndex !== itemIndex) })}
            disabled={disabled}
          />
        </div>
      ))}
    </div>
  );

  let body;
  if (block.type === 'text') {
    body = (
      <TextField
        label="Markdown body"
        value={block.body}
        onChange={(bodyValue) => patch({ body: bodyValue })}
        disabled={disabled}
        multiline
        rows={8}
        hint="Safe Markdown is supported. Raw HTML is not rendered."
      />
    );
  } else if (block.type === 'image' || block.type === 'video') {
    body = (
      <div className="authoring-field-grid">
        <TextField label="HTTPS URL" type="url" value={block.url} onChange={(url) => patch({ url })} disabled={disabled} placeholder="https://…" />
        <TextField label="Alt text" value={block.alt} onChange={(alt) => patch({ alt })} disabled={disabled} />
        <TextField label="Caption" value={block.caption} onChange={(caption) => patch({ caption })} disabled={disabled} />
      </div>
    );
  } else if (block.type === 'attachment') {
    body = (
      <div className="authoring-field-grid">
        <TextField label="HTTPS URL" type="url" value={block.url} onChange={(url) => patch({ url })} disabled={disabled} placeholder="https://…" />
        <TextField label="Link label" value={block.label} onChange={(label) => patch({ label })} disabled={disabled} />
      </div>
    );
  } else if (block.type === 'accordion') {
    body = renderNestedRows(
      block.items || [],
      'items',
      (item, itemIndex) => (
        <div className="authoring-nested-fields">
          <TextField label={`Item ${itemIndex + 1} title`} value={item.title} onChange={(title) => patch({ items: block.items.map((current, index) => index === itemIndex ? { ...current, title } : current) })} disabled={disabled} maxLength={300} />
          <TextField label="Body" value={item.body} onChange={(bodyValue) => patch({ items: block.items.map((current, index) => index === itemIndex ? { ...current, body: bodyValue } : current) })} disabled={disabled} multiline rows={4} maxLength={30000} />
        </div>
      ),
      () => ({ id: createAuthoringId('item'), title: '', body: '' }),
      'Item',
    );
  } else if (block.type === 'flashcards') {
    body = renderNestedRows(
      block.cards || [],
      'cards',
      (card, cardIndex) => (
        <div className="authoring-nested-fields">
          <TextField label={`Card ${cardIndex + 1} front`} value={card.front} onChange={(front) => patch({ cards: block.cards.map((current, index) => index === cardIndex ? { ...current, front } : current) })} disabled={disabled} multiline rows={3} maxLength={10000} />
          <TextField label="Back" value={card.back} onChange={(back) => patch({ cards: block.cards.map((current, index) => index === cardIndex ? { ...current, back } : current) })} disabled={disabled} multiline rows={3} maxLength={10000} />
        </div>
      ),
      () => ({ id: createAuthoringId('card'), front: '', back: '' }),
      'Card',
    );
  } else if (block.type === 'hotspots') {
    body = (
      <>
        <div className="authoring-field-grid">
          <TextField label="HTTPS image URL" type="url" value={block.url} onChange={(url) => patch({ url })} disabled={disabled} placeholder="https://…" />
          <TextField label="Alt text" value={block.alt} onChange={(alt) => patch({ alt })} disabled={disabled} />
        </div>
        {renderNestedRows(
          block.points || [],
          'points',
          (point, pointIndex) => (
            <div className="authoring-nested-fields">
              <div className="authoring-field-grid compact">
                <TextField label="X (%)" type="number" min="0" max="100" step="0.1" value={point.x} onChange={(value) => patch({ points: block.points.map((current, index) => index === pointIndex ? { ...current, x: value === '' ? '' : Number(value) } : current) })} disabled={disabled} />
                <TextField label="Y (%)" type="number" min="0" max="100" step="0.1" value={point.y} onChange={(value) => patch({ points: block.points.map((current, index) => index === pointIndex ? { ...current, y: value === '' ? '' : Number(value) } : current) })} disabled={disabled} />
              </div>
               <TextField label={`Point ${pointIndex + 1} label`} value={point.label} onChange={(label) => patch({ points: block.points.map((current, index) => index === pointIndex ? { ...current, label } : current) })} disabled={disabled} maxLength={300} />
               <TextField label="Point explanation" value={point.body} onChange={(bodyValue) => patch({ points: block.points.map((current, index) => index === pointIndex ? { ...current, body: bodyValue } : current) })} disabled={disabled} multiline rows={3} maxLength={2000} />
            </div>
          ),
          () => ({ id: createAuthoringId('point'), x: 50, y: 50, label: '', body: '' }),
          'Point',
        )}
      </>
    );
  } else if (block.type === 'check' || block.type === 'scenario') {
    const options = block.options || [];
    body = (
      <>
        <TextField label="Prompt" value={block.prompt} onChange={(prompt) => patch({ prompt })} disabled={disabled} multiline rows={3} />
        <TextField label="Scenario context (optional)" value={block.body} onChange={(bodyValue) => patch({ body: bodyValue })} disabled={disabled} multiline rows={4} />
        <div className="authoring-options">
          <div className="authoring-nested-heading">
            <div>
              <h4>Answer options</h4>
              <p className="authoring-muted">Select exactly one correct answer.</p>
            </div>
            <button type="button" className="authoring-btn ghost small" onClick={() => patch({ options: [...options, { id: createAuthoringId('option'), text: '' }] })} disabled={disabled}>
              Add option
            </button>
          </div>
          {options.length === 0 && <p className="authoring-muted authoring-empty-line">Add at least two options before publishing.</p>}
          {options.map((option, optionIndex) => (
            <div className={`authoring-option-row${block.correctOptionId === option.id ? ' selected' : ''}`} key={option.id || `option-${optionIndex}`}>
              <input
                type="radio"
                name={`correct-${block.id}`}
                checked={block.correctOptionId === option.id}
                onChange={() => patch({ correctOptionId: option.id })}
                disabled={disabled}
                aria-label={`Mark option ${optionIndex + 1} correct`}
              />
              <input
                aria-label={`Option ${optionIndex + 1} text`}
                value={option.text}
                onChange={(event) => patch({ options: options.map((current, index) => index === optionIndex ? { ...current, text: event.target.value } : current) })}
                disabled={disabled}
                placeholder={`Option ${optionIndex + 1}`}
                 maxLength={1000}
              />
              <ArrayControls
                index={optionIndex}
                length={options.length}
                onMove={(offset) => patch({ options: moveArrayItem(options, optionIndex, offset) })}
                onDuplicate={() => {
                  const copied = duplicateWithFreshIds(option);
                  patch({ options: [...options.slice(0, optionIndex + 1), copied, ...options.slice(optionIndex + 1)] });
                }}
                onDelete={() => {
                  const remaining = options.filter((_, currentIndex) => currentIndex !== optionIndex);
                  patch({ options: remaining, correctOptionId: block.correctOptionId === option.id ? (remaining[0]?.id || '') : block.correctOptionId });
                }}
                disabled={disabled}
              />
            </div>
          ))}
        </div>
        <TextField label="Correct answer explanation" value={block.explanation} onChange={(explanation) => patch({ explanation })} disabled={disabled} multiline rows={4} hint="Shown after a learner submits an answer." />
      </>
    );
  } else {
    body = <p className="authoring-inline-error">Unsupported block type: {block.type}</p>;
  }

  return (
    <article className="authoring-block">
      <div className="authoring-block-head">
        <div>
          <span className="authoring-block-number">Block {index + 1}</span>
          <h3>{typeLabel}</h3>
        </div>
        <div className="authoring-block-actions">
          <IconButton label="Move block up" onClick={() => onMove(-1)} disabled={disabled || index === 0}>↑</IconButton>
          <IconButton label="Move block down" onClick={() => onMove(1)} disabled={disabled || index === total - 1}>↓</IconButton>
          <IconButton label="Duplicate block" onClick={onDuplicate} disabled={disabled}>＋</IconButton>
          <IconButton label="Delete block" onClick={onDelete} disabled={disabled} danger>×</IconButton>
        </div>
      </div>
      <div className="authoring-block-body">{body}</div>
    </article>
  );
}
