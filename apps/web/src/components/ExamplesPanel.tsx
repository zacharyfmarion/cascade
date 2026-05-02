import React, { useMemo, useState } from 'react';
import { AlertTriangle, FolderOpen } from 'lucide-react';
import { CASCADE_EXAMPLES, EXAMPLE_SECTIONS, missingRequiredNodeTypes } from '../examples/catalog';
import type { CascadeExample } from '../examples/catalog';
import { useGraphStore } from '../store/graphStore';

const ExampleCard: React.FC<{
  example: CascadeExample;
  missing: string[];
  isOpening: boolean;
  onOpen: (id: string) => Promise<void>;
}> = ({ example, missing, isOpening, onOpen }) => {
  const disabled = missing.length > 0 || isOpening;

  return (
    <article
      style={{
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        border: '1px solid var(--border-default)',
        borderRadius: '8px',
        background: 'var(--bg-surface)',
      }}
    >
      <img
        src={example.thumbnailUrl}
        alt=""
        loading="lazy"
        style={{
          width: '100%',
          aspectRatio: '16 / 9',
          objectFit: 'cover',
          background: 'var(--bg-primary)',
          borderBottom: '1px solid var(--border-default)',
        }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px' }}>
        <div>
          <h3
            style={{
              margin: 0,
              color: 'var(--text-primary)',
              fontSize: '0.9rem',
              lineHeight: 1.25,
            }}
          >
            {example.title}
          </h3>
          <p
            style={{
              margin: '4px 0 0',
              color: 'var(--text-secondary)',
              fontSize: '0.78rem',
              lineHeight: 1.35,
            }}
          >
            {example.description}
          </p>
        </div>

        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          {example.tags.map(tag => (
            <span
              key={tag}
              style={{
                color: 'var(--text-muted)',
                background: 'var(--bg-primary)',
                border: '1px solid var(--border-default)',
                borderRadius: '4px',
                fontSize: '0.68rem',
                lineHeight: 1,
                padding: '4px 6px',
              }}
            >
              {tag}
            </span>
          ))}
        </div>

        {missing.length > 0 && (
          <div
            role="status"
            style={{
              display: 'flex',
              gap: '6px',
              alignItems: 'flex-start',
              color: 'var(--text-secondary)',
              fontSize: '0.72rem',
              lineHeight: 1.35,
            }}
          >
            <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>Requires unavailable nodes: {missing.join(', ')}</span>
          </div>
        )}

        <button
          type="button"
          disabled={disabled}
          onClick={() => void onOpen(example.id)}
          style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            gap: '6px',
            minHeight: '32px',
            border: '1px solid var(--border-default)',
            borderRadius: '4px',
            background: disabled ? 'var(--bg-primary)' : 'var(--accent-primary)',
            color: disabled ? 'var(--text-muted)' : 'var(--text-on-accent)',
            cursor: disabled ? 'not-allowed' : 'pointer',
            font: 'inherit',
            fontSize: '0.8rem',
          }}
        >
          <FolderOpen size={14} />
          {isOpening ? 'Opening...' : 'Open Example'}
        </button>
      </div>
    </article>
  );
};

export const ExamplesPanel: React.FC = () => {
  const nodeSpecs = useGraphStore(s => s.nodeSpecs);
  const requestOpenExample = useGraphStore(s => s.requestOpenExample);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const examplesBySection = useMemo(() => (
    EXAMPLE_SECTIONS.map(section => ({
      section,
      examples: CASCADE_EXAMPLES.filter(example => example.section === section),
    }))
  ), []);

  const openExample = async (exampleId: string) => {
    setOpeningId(exampleId);
    try {
      await requestOpenExample(exampleId);
    } finally {
      setOpeningId(null);
    }
  };

  return (
    <div className="panel" style={{ width: '100%', height: '100%', minHeight: 0, overflow: 'hidden' }}>
      <div
        style={{
          padding: '10px 12px',
          borderBottom: '1px solid var(--border-default)',
          background: 'var(--bg-primary)',
        }}
      >
        <h2
          style={{
            margin: 0,
            color: 'var(--text-primary)',
            fontSize: '0.86rem',
            lineHeight: 1.2,
          }}
        >
          Examples
        </h2>
        <p
          style={{
            margin: '4px 0 0',
            color: 'var(--text-secondary)',
            fontSize: '0.74rem',
            lineHeight: 1.35,
          }}
        >
          Open a bundled project to see a finished node graph.
        </p>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '10px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {examplesBySection.map(({ section, examples }) => (
          <section key={section} aria-label={section} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <h3
              style={{
                margin: 0,
                color: 'var(--text-secondary)',
                fontSize: '0.72rem',
                fontWeight: 700,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
              }}
            >
              {section}
            </h3>
            {examples.map(example => (
              <ExampleCard
                key={example.id}
                example={example}
                missing={missingRequiredNodeTypes(example, nodeSpecs)}
                isOpening={openingId === example.id}
                onOpen={openExample}
              />
            ))}
          </section>
        ))}
      </div>
    </div>
  );
};
