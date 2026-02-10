export function useTopUps() {
  function getBexioInvoiceUrl(bexioInvoiceId: number): string {
    return `https://office.bexio.com/index.php/kb_invoice/show/id/${bexioInvoiceId}`
  }

  return {
    getBexioInvoiceUrl
  }
}
