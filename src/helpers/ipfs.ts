import axios from "axios";
import { IPFSParams } from "../types";
import { ApiBaseUrl } from "../addresses";

// List of public IPFS gateways to cycle through
const IPFS_GATEWAYS = ["https://ipfs.io/ipfs/", "https://dweb.link/ipfs/"];

// Counter to track the current gateway index
let currentGatewayIndex = 0;

export const resolveIPFS = (value: string): string => {
  if (value.startsWith("ipfs://")) {
    const cid = value.slice(7);
    // Get the next gateway and increment the counter
    const gateway = IPFS_GATEWAYS[currentGatewayIndex];
    // Update the counter, cycling back to 0 when we reach the end
    currentGatewayIndex = (currentGatewayIndex + 1) % IPFS_GATEWAYS.length;
    return `${gateway}${cid}`;
  }
  return value;
};

/**
 * Every gateway URL an ipfs:// value can resolve to, so a fetch can fail over
 * when a public gateway rejects the request (they rate limit aggressively).
 * Non-IPFS values resolve to themselves.
 */
export const resolveIPFSCandidates = (value: string): string[] => {
  if (value.startsWith("ipfs://")) {
    const cid = value.slice(7);
    return IPFS_GATEWAYS.map((gateway) => `${gateway}${cid}`);
  }
  return [value];
};

/**
 * Bounds for fetching coin metadata from a resolved tokenURI. The URI is
 * attacker-controlled onchain data, so cap the request rather than handing
 * axios an unbounded one.
 */
const METADATA_FETCH_TIMEOUT_MS = 15_000;
const METADATA_MAX_REDIRECTS = 3;
const METADATA_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Fetches token metadata from a resolved tokenURI over HTTP(S).
 *
 * @remarks
 * Applies a timeout, a redirect cap, and a response-size cap, and rejects
 * non-HTTP(S) protocols. It does NOT defend against SSRF: a coin's tokenURI
 * is arbitrary onchain data, so in a server context it can point at private
 * or link-local addresses. When calling this from a server with untrusted
 * coin addresses, route it through your own vetted fetch or egress policy
 * (see `setIPFSResolver` to swap the resolver, and the README).
 */
export const fetchTokenUriMetadata = async (url: string): Promise<any> => {
  if (!/^https?:\/\//i.test(url)) {
    throw new Error(`Unsupported tokenURI protocol: ${url.slice(0, 64)}`);
  }
  const response = await axios.get(url, {
    timeout: METADATA_FETCH_TIMEOUT_MS,
    maxRedirects: METADATA_MAX_REDIRECTS,
    maxContentLength: METADATA_MAX_BYTES,
    maxBodyLength: METADATA_MAX_BYTES,
  });
  return response.data;
};

/**
 * Fetches token metadata trying each candidate URL in order, so an ipfs://
 * tokenURI survives one public gateway refusing the request. Throws the last
 * error when every candidate fails.
 */
export const fetchTokenUriMetadataWithFallback = async (
  urls: string[]
): Promise<any> => {
  let lastError: unknown;
  for (const url of urls) {
    try {
      return await fetchTokenUriMetadata(url);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
};

/** Decodes a base64 (optionally data-URL) image into bytes + mime type. */
const decodeBase64Image = (
  base64Image: string
): { bytes: Uint8Array; mimeType: string } => {
  const base64Data = base64Image.split(",")[1] || base64Image;
  const byteCharacters = atob(base64Data);
  const bytes = new Uint8Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    bytes[i] = byteCharacters.charCodeAt(i);
  }

  let mimeType = "image/png"; // default
  if (base64Image.startsWith("data:")) {
    mimeType = base64Image.split(";")[0].split(":")[1];
  }

  return { bytes, mimeType };
};

/**
 * Pins a token image + metadata through the ubi.fun API upload endpoint (the
 * same path the app uses: POST {apiUrl}/upload) and returns the tokenUri.
 * IP rate limited; 5MB image cap.
 */
export const uploadToUbiApi = async (params: {
  apiUrl: string;
  name: string;
  symbol: string;
  base64Image: string;
  description: string;
  websiteUrl?: string;
  discordUrl?: string;
  twitterUrl?: string;
  telegramUrl?: string;
}): Promise<{ tokenUri: string; image: string }> => {
  const { bytes, mimeType } = decodeBase64Image(params.base64Image);

  const formData = new FormData();
  formData.append(
    "image",
    new Blob([bytes as BlobPart], { type: mimeType }),
    `image.${mimeType.split("/")[1] ?? "png"}`
  );
  formData.append("name", params.name);
  formData.append("symbol", params.symbol);
  formData.append("description", params.description);
  if (params.websiteUrl) {
    formData.append("website", params.websiteUrl);
  }
  if (params.discordUrl) {
    formData.append("discord", params.discordUrl);
  }
  if (params.twitterUrl) {
    formData.append("twitter", params.twitterUrl);
  }
  if (params.telegramUrl) {
    formData.append("telegram", params.telegramUrl);
  }

  try {
    const response = await axios.post(`${params.apiUrl}/upload`, formData);
    return {
      tokenUri: response.data.tokenUri,
      image: response.data.image,
    };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(
        `Failed to upload token metadata: ${
          error.response?.data?.error || error.message
        }`
      );
    }
    throw error;
  }
};

/**
 * Pins the token image + metadata through the ubi.fun API and returns the
 * `ipfs://` tokenUri to pass into a flaunch call.
 *
 * To host metadata yourself (any provider, any storage), skip this entirely:
 * upload however you like, then pass the resulting URI straight to
 * `flaunch({ tokenUri })`.
 */
export const generateTokenUri = async (
  name: string,
  symbol: string,
  params: IPFSParams & { chainId: number }
) => {
  const apiUrl = ApiBaseUrl[params.chainId];
  if (!apiUrl) {
    throw new Error(
      `No ubi.fun API for chain ${params.chainId}; pin the metadata yourself and pass flaunch({ tokenUri })`
    );
  }

  const { tokenUri } = await uploadToUbiApi({
    apiUrl,
    name,
    symbol,
    base64Image: params.metadata.base64Image,
    description: params.metadata.description,
    websiteUrl: params.metadata.websiteUrl,
    discordUrl: params.metadata.discordUrl,
    twitterUrl: params.metadata.twitterUrl,
    telegramUrl: params.metadata.telegramUrl,
  });

  return tokenUri;
};
