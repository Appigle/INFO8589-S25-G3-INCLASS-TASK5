import React, { useEffect } from 'react';
import { loadScript } from '@paypal/paypal-js';

export default function PayPalButton({ amount }) {
  useEffect(() => {
    const tracer = globalThis.__otelTracer ? globalThis.__otelTracer() : null;

    const run = async () => {
      const rootSpan = tracer?.startSpan('paypal.componentInit', {
        attributes: { 'paypal.amount': amount }
      });

      try {
        // These will hit our backend; in dev we’ll proxy them (see Step 7)
        const clientRes = await fetch('clientid');
        const { clientid } = await clientRes.json();

        const paypal = await loadScript({ clientId: clientid });
        paypal.resultMessage = (msg) => {
          const el = document.getElementById('result-message');
          if (el) el.innerHTML = msg;
        };

        await paypal.Buttons({
          style: { shape: 'rect', layout: 'vertical', color: 'gold', label: 'paypal' },

          async createOrder() {
            const span = tracer?.startSpan('paypal.createOrder');
            try {
              const res = await fetch('orders', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ cart: [{ id: 'YOUR_PRODUCT_ID', quantity: 'YOUR_PRODUCT_QUANTITY' }] }),
              });
              const data = await res.json();
              span?.end();
              return data.id;
            } catch (err) {
              span?.recordException(err);
              span?.setAttribute('error', true);
              span?.end();
            }
          },

          async onApprove(data, actions) {
            const span = tracer?.startSpan('paypal.onApprove');
            try {
              const res = await fetch(`capture/${data.orderID}`, { method: 'POST' });
              const orderData = await res.json();
              span?.end();
              console.log('Transaction approved:', orderData);
              paypal.resultMessage(`Transaction completed!`);
            } catch (err) {
              span?.recordException(err);
              span?.setAttribute('error', true);
              span?.end();
            }
          }
        }).render('#paypal-button-container');

      } catch (err) {
        rootSpan?.recordException(err);
        rootSpan?.setAttribute('error', true);
      } finally {
        rootSpan?.end();
      }
    };

    run();
  }, [amount]);

  return (
    <>
      <div id="paypal-button-container"></div>
      <p id="result-message"></p>
    </>
  );
}
