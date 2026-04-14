import { Injectable } from '@nestjs/common';
import { RateLimiter } from 'limiter';

import { HttpService } from '@/clients/http.service';
import { SuperheroHistoryResponse } from '@/clients/superhero-client.model';

const SUPERHERO_API_URL = 'https://api.superhero.com/api';
// Days values supported by the Superhero /coins/aeternity/history endpoint.
// Hourly interval is only available for days <= 90.
const SUPPORTED_DAYS = [1, 7, 14, 30, 90, 180, 365] as const;

@Injectable()
export class SuperheroClientService {
  constructor(private httpService: HttpService) {}

  private readonly CALLS_LIMIT = 28;
  private readonly CALL_INTERVAL = 'minute';
  private rateLimiter = new RateLimiter({
    tokensPerInterval: this.CALLS_LIMIT,
    interval: this.CALL_INTERVAL,
  });

  async getHistoricalPriceDataThrottled(
    microBlockTime: number,
  ): Promise<number> {
    await this.rateLimiter.removeTokens(1);
    const daysSince = Math.ceil(
      (Date.now() - microBlockTime) / (24 * 60 * 60 * 1000),
    );
    const days = SUPPORTED_DAYS.find((d) => d >= daysSince) ?? ('max' as const);
    const interval =
      typeof days === 'number' && days <= 90 ? 'hourly' : 'daily';
    const url = `${SUPERHERO_API_URL}/coins/aeternity/history?currency=usd&days=${days}&interval=${interval}`;
    const prices = await this.httpService.get<SuperheroHistoryResponse>(url);
    return this.findClosestPrice(prices, microBlockTime);
  }

  private findClosestPrice(
    prices: SuperheroHistoryResponse,
    targetTime: number,
  ): number {
    if (!prices.length) {
      throw new Error('No price data returned from Superhero API');
    }
    return prices.reduce((best, current) =>
      Math.abs(current[0] - targetTime) < Math.abs(best[0] - targetTime)
        ? current
        : best,
    )[1];
  }
}
