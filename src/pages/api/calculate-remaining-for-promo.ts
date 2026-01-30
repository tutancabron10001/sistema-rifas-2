import { getTxLedgerSummary } from '../../lib/tx-ledger';

export async function GET({ url }: any) {
  try {
    const transactionNumber = url.searchParams.get('transactionNumber');
    const promoPrice = url.searchParams.get('promoPrice');

    if (!transactionNumber || !promoPrice) {
      return new Response(
        JSON.stringify({ error: 'Missing transactionNumber or promoPrice' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const ledger = await getTxLedgerSummary(String(transactionNumber).trim());
    const totalPromoPrice = Number(promoPrice) || 0;
    const alreadyCredited = ledger.creditedTotal || 0;
    const remaining = Math.max(0, totalPromoPrice - alreadyCredited);

    return new Response(
      JSON.stringify({
        success: true,
        transactionNumber: ledger.transactionNumber,
        totalPromoPrice,
        alreadyCredited,
        remaining,
        ledger,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error calculating remaining for promo:', error);
    return new Response(
      JSON.stringify({ error: 'Error al calcular' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
