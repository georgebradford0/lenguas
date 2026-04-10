import RNFS from 'react-native-fs';
import JSZip from 'jszip';

export async function getEpubTitle(localUri: string): Promise<string | null> {
  const filePath = localUri.replace(/^file:\/\//, '');
  const base64 = await RNFS.readFile(filePath, 'base64');
  const zip = await JSZip.loadAsync(base64, { base64: true });

  const containerXml = await zip.file('META-INF/container.xml')?.async('string');
  if (!containerXml) return null;

  const opfMatch = containerXml.match(/full-path="([^"]+)"/);
  if (!opfMatch) return null;

  const opfXml = await zip.file(opfMatch[1])?.async('string');
  if (!opfXml) return null;

  const titleMatch = opfXml.match(/<dc:title[^>]*>([^<]+)<\/dc:title>/);
  return titleMatch ? titleMatch[1].trim() : null;
}
