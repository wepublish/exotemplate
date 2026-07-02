export function useTopUps() {
  function getBexioInvoiceUrl(bexioInvoiceId: number): string {
    return `https://office.bexio.com/index.php/kb_invoice/show/id/${bexioInvoiceId}`
  }

  function getBexioOrderUrl(bexioOrderId: number): string {
    return `https://office.bexio.com/index.php/kb_order/show/id/${bexioOrderId}`
  }

  return {
    getBexioInvoiceUrl,
    getBexioOrderUrl
  }
}
