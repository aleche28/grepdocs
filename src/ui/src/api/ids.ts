// An ID from the URL (a query or route parameter): a positive integer in
// plain decimal, or null. The API's IDs are bigint, so anything else names
// nothing it could return.
export function parseId(value: string | null | undefined): number | null {
  if (value == null || !/^[1-9][0-9]*$/.test(value)) {
    return null
  }
  const id = Number(value)
  return Number.isSafeInteger(id) ? id : null
}
