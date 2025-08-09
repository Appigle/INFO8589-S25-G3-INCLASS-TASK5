import React from 'react';
import Year from './components/Year';
import PayPalButton from './components/PayPalButton';

export default function App() {
  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: 16 }}>
      <h1>Sample Microfrontend (React)</h1>
      <p>Year: <Year /></p>
      <PayPalButton amount="10.00" />
    </div>
  );
}
