import { DEBUG } from "../config";
import { Hex } from "./types";
 
/**
 * Converts a hex string into a Uint8Array.
 *
 * @param hex - A hex-encoded string (must contain only hexadecimal characters, without any 0x prefix).
 * @returns A Uint8Array containing the byte values represented by the hex string.
 * @throws {Error} If the provided hex string has an odd length (invalid hex string).
 *
 * @example
 * hexToUint8Array("ff00a1"); // => Uint8Array [255, 0, 161]
 */
export function hexToUint8Array(hex: Hex) {
  if (hex.length % 2 !== 0) {
    throw new Error("Invalid hex string");
  }
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) {
    arr[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return arr;
}
 
/**
 * Encodes a Uint8Array into a Base64 string using the browser btoa API.
 *
 * Note: This implementation builds a binary string via String.fromCharCode for each byte and then calls btoa.
 * It is intended for browser environments where btoa is available. For very large arrays consider alternative approaches to avoid high memory usage.
 *
 * @param uint8Array - The bytes to encode as Base64.
 * @returns A Base64-encoded string representing the input bytes.
 *
 * @example
 * uint8ArrayToBase64(new Uint8Array([72, 101, 108, 108, 111])); // => "SGVsbG8="
 */
export function uint8ArrayToBase64(uint8Array: Uint8Array) {
  let binary = "";
  for (let i = 0; i < uint8Array.length; i++) {
    binary += String.fromCharCode(uint8Array[i]);
  }
  return btoa(binary);
}

/**
 * Decodes a Base64 (or URL-safe Base64) string into a Uint8Array.
 *
 * This function normalizes URL-safe base64 by replacing '-' with '+' and '_' with '/', and it adds padding if missing
 * before decoding with atob. Works in browser environments where atob is available.
 *
 * @param base64 - A Base64 or URL-safe Base64 encoded string.
 * @returns The decoded bytes as a Uint8Array.
 *
 * @example
 * base64ToUint8Array("SGVsbG8="); // => Uint8Array [72, 101, 108, 108, 111]
 */
export const base64ToUint8Array = (base64: string): Uint8Array => {
  // Convert URL-safe base64 to standard base64.
  base64 = base64.replace(/-/g, "+").replace(/_/g, "/");
  // Add padding if missing.
  while (base64.length % 4) {
    base64 += "=";
  }
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
};

/**
 * Decodes a Base64-encoded field into a Uint8Array and handles possible double-encoding.
 *
 * If expectedLength is provided and the decoded byte length does not match, this helper checks whether the decoded result
 * is exactly twice the expected length. If so, it treats the decoded bytes as a UTF-8 string containing another Base64 value,
 * decodes that second Base64 string, and returns it if it matches the expected length. Otherwise the initially decoded bytes are returned.
 *
 * @param field - The Base64 (or URL-safe Base64) encoded field to decode.
 * @param expectedLength - Optional expected length of the final decoded byte array. When provided, enables the double-decoding heuristic.
 * @returns The decoded bytes as a Uint8Array. If double-encoding is detected and validated, the inner decoded bytes are returned.
 *
 * @example
 * // Single-encoded
 * decodeField("SGVsbG8=", 5); // => Uint8Array [72, 101, 108, 108, 111]
 *
 * @example
 * // Double-encoded: base64(base64(bytes))
 * decodeField("U0dWc2JHOGU=", 5); // => Uint8Array [72, 101, 108, 108, 111]
 */
export const decodeField = (
  field: string,
  expectedLength?: number
): Uint8Array => {
  const bytes = base64ToUint8Array(field);
  if (expectedLength && bytes.length !== expectedLength) {
    // If we got exactly twice as many bytes as expected, assume double-encoding.
    if (bytes.length === expectedLength * 2) {
      const intermediateStr = new TextDecoder().decode(bytes);
      const secondBytes = base64ToUint8Array(intermediateStr);
      if (secondBytes.length === expectedLength) {
        return secondBytes;
      }
    }
  }
  return bytes;
};

/**
 * Conditional debug logging utility.
 * Only logs when DEBUG flag is enabled in config.
 * 
 * @param message - The message to log
 * @param optionalParams - Additional parameters to log
 */
export const debugLog = (message?: any, ...optionalParams: any[]) => {
  if (DEBUG) {
    console.log(message, ...optionalParams);
  }
};
