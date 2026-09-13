/** Custom authenticated media schemes must be fetched before Chromium can
 * download them; navigating an anchor to the scheme is not a download. */
export async function downloadHubMedia(url: string, name: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed (${response.status})`);
  const blob = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = blob;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(blob), 60_000);
}
