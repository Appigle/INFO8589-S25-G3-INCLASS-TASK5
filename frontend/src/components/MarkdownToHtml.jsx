import React, { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';

export default function MarkdownToHtml({ src }) {
  const [content, setContent] = useState('');
  useEffect(() => {
    fetch(src)
      .then(r => (r.ok ? r.text() : Promise.reject(new Error(`Failed to load ${src}`))))
      .then(setContent)
      .catch(err => {
        console.error(err);
        setContent(`Error loading ${src}`);
      });
  }, [src]);
  return <ReactMarkdown>{content}</ReactMarkdown>;
}
