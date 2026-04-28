import { z } from "zod";

import type { AppConfig } from "../config.js";

const nullableNumber = z
  .number()
  .or(z.string())
  .transform((value) => Number(value))
  .pipe(z.number().finite())
  .nullish()
  .transform((value) => value ?? undefined);

const cloudResponseSchema = z
  .object({
    success: z.boolean().optional(),
    code: z.number().optional(),
    exception: z.string().optional(),
    result: z
      .object({
        sn: z.string().optional(),
        inverterSN: z.string().optional(),
        uploadTime: z.string().optional(),
        soc: nullableNumber,
        batPower: nullableNumber,
        powerdc1: nullableNumber,
        powerdc2: nullableNumber,
        powerdc3: nullableNumber,
        powerdc4: nullableNumber,
        acpower: nullableNumber,
        feedinpower: nullableNumber,
        yieldtoday: nullableNumber,
        yieldtotal: nullableNumber,
        feedinenergy: nullableNumber,
        consumeenergy: nullableNumber,
        inverterStatus: z.string().or(z.number()).optional(),
        inverterType: z.string().or(z.number()).optional(),
        batStatus: z.string().or(z.number()).nullish(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type SolaxCloudRealtimeResult = NonNullable<
  z.infer<typeof cloudResponseSchema>["result"]
>;

export interface SolaxCloudResponse {
  result: SolaxCloudRealtimeResult;
}

export class SolaxCloudClient {
  public constructor(private readonly config: AppConfig) {}

  public async getRealtimeInfo(): Promise<SolaxCloudResponse> {
    const url = this.buildRealtimeInfoUrl();
    const abortController = new AbortController();
    const timeout = setTimeout(
      () => abortController.abort(),
      this.config.SOLAX_CLOUD_TIMEOUT_MS,
    );

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          tokenId: this.config.SOLAX_CLOUD_TOKEN_ID ?? "",
        },
        body: JSON.stringify({
          wifiSn: this.config.SOLAX_CLOUD_WIFI_SN,
        }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error(
          `SolaX Cloud API request failed with HTTP ${response.status}.`,
        );
      }

      const body: unknown = await response.json();
      const parsed = cloudResponseSchema.parse(body);

      if (parsed.success === false) {
        throw new Error(
          `SolaX Cloud API request failed: ${parsed.exception ?? "unknown error"}.`,
        );
      }

      if (parsed.result === undefined) {
        throw new Error("SolaX Cloud API response did not contain result data.");
      }

      return { result: parsed.result };
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildRealtimeInfoUrl(): URL {
    const url = new URL(
      "/api/v2/dataAccess/realtimeInfo/get",
      this.config.SOLAX_CLOUD_BASE_URL,
    );

    if (this.config.SOLAX_CLOUD_TOKEN_ID === undefined) {
      throw new Error("SOLAX_CLOUD_TOKEN_ID is required.");
    }

    if (this.config.SOLAX_CLOUD_WIFI_SN === undefined) {
      throw new Error("SOLAX_CLOUD_WIFI_SN is required.");
    }

    return url;
  }
}
