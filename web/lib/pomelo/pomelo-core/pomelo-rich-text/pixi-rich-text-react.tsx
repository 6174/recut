import React, { useEffect, useState } from 'react';
import { Stage, Container } from '@pixi/react';
import { Delta, LayoutResult } from './pixi-rich-text.types';
import { PixiRichText } from './pixi-rich-text';

interface RichTextComponentProps {
  delta: Delta;
  width: number;
  height: number;
}

export const RichTextComponent: React.FC<RichTextComponentProps> = ({ delta, width, height }) => {
  const [layoutResult, setLayoutResult] = useState<LayoutResult | undefined>(undefined);
  const [richText, setRichText] = useState<PixiRichText | null>(null);

  useEffect(() => {
    // Initialize RichText component
    const newRichText = new PixiRichText(delta, width, height);
    setRichText(newRichText);

    // Calculate layout and set initial state
    const initialLayoutResult = newRichText.getLayoutResult();
    setLayoutResult(initialLayoutResult);

    return () => {
      // Clean up resources
      newRichText.destroy();
    };
  }, [delta, width, height]);

  useEffect(() => {
    // Update RichText when delta prop changes
    if (richText) {
      richText.updateDelta(delta);
      const updatedLayoutResult = richText.getLayoutResult();
      setLayoutResult(updatedLayoutResult);
    }
  }, [delta]);

  return (
      <Container>
        {/* Render rich text based on layoutResult */}
        {
          layoutResult && (
            /* Implement rendering logic based on layoutResult */
            /* Example: map over lines and texts, create PIXI.Text components */
            <></>
          )
        }
      </Container>
    );
};
