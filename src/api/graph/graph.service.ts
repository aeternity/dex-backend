import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Token } from '@prisma/client';
import BigNumber from 'bignumber.js';

import { OrderQueryEnum } from '@/api/api.model';
import { Graph, GraphType, TimeFrame } from '@/api/graph/graph.model';
import { PairLiquidityInfoHistoryWithTokens } from '@/api/pair-liquidity-info-history/pair-liquidity-info-history.model';
import { PairLiquidityInfoHistoryService } from '@/api/pair-liquidity-info-history/pair-liquidity-info-history.service';
import { ContractAddress } from '@/clients/sdk-client.model';
import { PairDbService } from '@/database/pair/pair-db.service';
import { PairLiquidityInfoHistoryDbService } from '@/database/pair-liquidity-info-history/pair-liquidity-info-history-db.service';
import { TokenDbService } from '@/database/token/token-db.service';

const TIME_FRAMES = {
  '1H': 1,
  '1D': 24,
  '1W': 24 * 7,
  '1M': 24 * 30,
  '1Y': 24 * 365,
  MAX: Infinity,
};

@Injectable()
export class GraphService {
  constructor(
    private readonly pairLiquidityInfoHistoryDb: PairLiquidityInfoHistoryDbService,
    private readonly tokenDb: TokenDbService,
    private readonly pairDb: PairDbService,
    private readonly pairLiquidityInfoHistoryService: PairLiquidityInfoHistoryService,
  ) {}

  async getGraph(
    graphType: GraphType,
    timeFrame: TimeFrame,
    tokenAddress?: ContractAddress,
    pairAddress?: ContractAddress,
  ): Promise<Graph> {
    let token: Token | undefined = undefined;
    // VALIDATION
    if (pairAddress && tokenAddress) {
      throw new BadRequestException(
        'It is not possible to request a graph for both tokenAddress and pairAddress',
      );
    }
    if (tokenAddress) {
      const res = await this.tokenDb.getWithAggregation(tokenAddress);
      if (!res) {
        throw new NotFoundException('Token not found');
      }
      token = res;
    }
    if (pairAddress) {
      const pair = await this.pairDb.getOne(pairAddress);
      if (!pair) {
        throw new NotFoundException('Pair not found');
      }
    }

    const history = await this.pairLiquidityInfoHistoryDb.getAll({
      order: OrderQueryEnum.asc,
      pairAddress,
      tokenAddress,
    });

    const graphData = this.graphData(
      history,
      pairAddress,
      tokenAddress,
      token,
      graphType,
    );
    const filteredData = this.filteredData(graphData, graphType, timeFrame);
    return this.bucketedGraphData(filteredData, graphType, timeFrame);
  }

  private graphData(
    history: PairLiquidityInfoHistoryWithTokens[],
    pairAddress: ContractAddress | undefined,
    tokenAddress: ContractAddress | undefined,
    token: Token | undefined,
    graphType: GraphType,
  ) {
    let tvl = new BigNumber(0);
    let reserve = new BigNumber(0);
    return history.reduce(
      (
        acc: {
          x: number[];
          data: string[];
        },
        tx,
      ) => {
        const entry =
          this.pairLiquidityInfoHistoryService.mapToEntryWithPrice(tx);

        if (!pairAddress && !tokenAddress) {
          // OVERVIEW
          if (graphType === GraphType.TVL) {
            // TVL
            // deltaUsdValue is already calculated but absolute, so we need to check the deltaReserve to get the sign
            const delta0 = new BigNumber(entry.delta0UsdValue || '').times(
              Math.sign(Number(entry.deltaReserve0)),
            );
            const delta1 = new BigNumber(entry.delta1UsdValue || '').times(
              Math.sign(Number(entry.deltaReserve1)),
            );
            tvl = tvl
              .plus(delta0.isNaN() ? 0 : delta0)
              .plus(delta1.isNaN() ? 0 : delta1);
            acc.data = [...acc.data, tvl.toString()].map((d) => d || '0');
          } else if (graphType === GraphType.Volume) {
            // VOLUME
            if (entry.type === 'SwapTokens') {
              acc.data = [
                ...acc.data,
                new BigNumber(entry.delta0UsdValue || 0)
                  .plus(entry.delta1UsdValue || 0)
                  .toString(),
              ].map((d) => d || '0');
            } else {
              acc.data = [...acc.data, '0'].map((d) => d || '0');
            }
          } else {
            throw new BadRequestException(
              `The graph type '${graphType}' is not available for the overview.`,
            );
          }
        } else if (token && !pairAddress) {
          // TOKENS
          const txDeltaReserve =
            token.address === tx.pair.token0.address
              ? entry.deltaReserve0
              : entry.deltaReserve1;
          reserve = reserve.plus(txDeltaReserve);
          const txPriceUsd = BigNumber(
            token.address === tx.pair.token0.address
              ? entry.token0AePrice || ''
              : entry.token1AePrice || '',
          ).multipliedBy(entry.aeUsdPrice);
          if (graphType === GraphType.Price) {
            // PRICE
            acc.data = [...acc.data, txPriceUsd.toString()].map(
              (d) => d || '0',
            );
          } else if (graphType === GraphType.TVL) {
            // TVL
            acc.data = [
              ...acc.data,
              new BigNumber(reserve)
                .multipliedBy(txPriceUsd)
                .div(new BigNumber(10).pow(token.decimals))
                .toString(),
            ].map((d) => d || '0');
          } else if (graphType === GraphType.Locked) {
            // LOCKED
            acc.data = [
              ...acc.data,
              new BigNumber(reserve)
                .div(new BigNumber(10).pow(token.decimals))
                .toString(),
            ].map((d) => d || '0');
          } else if (graphType === GraphType.Volume) {
            // Volume
            if (entry.type === 'SwapTokens') {
              acc.data = [
                ...acc.data,
                new BigNumber(txDeltaReserve)
                  .abs()
                  .multipliedBy(txPriceUsd)
                  .div(new BigNumber(10).pow(token.decimals))
                  .toString(),
              ].map((d) => d || '0');
            } else {
              acc.data = [...acc.data, '0'];
            }
          } else {
            throw new BadRequestException(
              `The graph type '${graphType}' is not available for tokens.`,
            );
          }
        } else if (!tokenAddress && pairAddress) {
          // POOLS
          if (graphType === GraphType.PriceToken1InToken0) {
            // Price token 1 in token 0: Reserve 0 normalized / Reserve 1 normalized
            acc.data = [
              ...acc.data,
              new BigNumber(entry.reserve0)
                .div(BigNumber(10).pow(tx.pair.token0.decimals))
                .div(
                  new BigNumber(entry.reserve1).div(
                    BigNumber(10).pow(tx.pair.token1.decimals),
                  ),
                )
                .toString(),
            ].map((d) => d || '0');
          } else if (graphType === GraphType.PriceToken0InToken1) {
            // Price token 0 in token 1: Reserve 1 normalized / Reserve 0 normalized
            acc.data = [
              ...acc.data,
              new BigNumber(entry.reserve1)
                .div(BigNumber(10).pow(tx.pair.token1.decimals))
                .div(
                  new BigNumber(entry.reserve0).div(
                    BigNumber(10).pow(tx.pair.token0.decimals),
                  ),
                )
                .toString(),
            ].map((d) => d || '0');
          } else if (graphType === GraphType.TVL) {
            // TVL
            acc.data = [
              ...acc.data,
              new BigNumber(entry.reserve0Usd || '')
                .plus(entry.reserve1Usd || '')
                .toString(),
            ].map((d) => d || '0');
          } else if (graphType === GraphType.Fees) {
            // Fee
            acc.data = [...acc.data, entry.txUsdFee].map((d) => d || '0');
          } else if (graphType === GraphType.Volume) {
            // Volume
            if (entry.type === 'SwapTokens') {
              acc.data = [
                ...acc.data,
                new BigNumber(entry.delta0UsdValue || '')
                  .plus(entry.delta1UsdValue || '')
                  .toString(),
              ].map((d) => d || '0');
            } else {
              acc.data = [...acc.data, '0'].map((d) => d || '0');
            }
          } else {
            throw new BadRequestException(
              `The graph type '${graphType}' is not available for pairs.`,
            );
          }
        }

        acc.x = [...acc.x, Number(entry.microBlockTime)];
        return acc;
      },
      {
        x: [],
        data: [],
      },
    );
  }

  private filteredData(
    graphData: {
      x: number[];
      data: string[];
    },
    graphType: GraphType,
    timeFrame: TimeFrame,
  ) {
    const minTime =
      timeFrame === TimeFrame.MAX
        ? Math.min(...graphData.x)
        : Date.now() - 1000 * 60 * 60 * TIME_FRAMES[timeFrame];

    const data = {
      filteredData: graphData.data
        .filter((_, i) => graphData.x[i] >= minTime)
        .filter((d) => !new BigNumber(d).isNaN()),
      excludedData: graphData.data
        .filter((_, i) => graphData.x[i] < minTime)
        .filter((d) => !new BigNumber(d).isNaN()),
      filteredTime: graphData.x
        .filter((_, i) => !new BigNumber(graphData.data[i]).isNaN())
        .filter((d) => d >= minTime)
        .map((d) => Number(d)),
      excludedTime: graphData.x
        .filter((_, i) => !new BigNumber(graphData.data[i]).isNaN())
        .filter((d) => d < minTime)
        .map((d) => Number(d)),
    };

    // interpolate data to show full frame
    if (
      ([GraphType.TVL, GraphType.Locked].includes(graphType) ||
        graphType.toString().includes('Price')) &&
      data.excludedData.length > 0
    ) {
      // all of these are aggregated and summed, so we need to have baseline
      data.filteredData.unshift(<string>data.excludedData.pop());
      data.filteredTime.unshift(minTime);
      data.excludedTime.pop();
    }

    if (
      [GraphType.Volume, GraphType.Fees].includes(graphType) &&
      data.filteredData.length > 0
    ) {
      // these just show the last value, so we need to have a baseline for the graph time but no value
      // if there is no data, we do not need to add anything as we can show "no data"
      data.filteredData.unshift('0');
      data.filteredTime.unshift(minTime);
    }

    if (graphType.toString().includes('Price')) {
      // as these always have current value, we need to add it to the end
      // theoretically this is also required for TVL and locked, but we interpolate those in the graph based
      // on the last value, so we don't need to add it here
      data.filteredData.push(data.filteredData[data.filteredData.length - 1]);
      data.filteredTime.push(Date.now());
    }

    return {
      ...data,
      minTime,
    };
  }

  private bucketedGraphData(
    filteredDataInput: {
      filteredData: string[];
      excludedData: string[];
      filteredTime: number[];
      excludedTime: number[];
      minTime: number;
    },
    graphType: GraphType,
    timeFrame: TimeFrame,
  ): Graph {
    // filter data based on selected time
    const { filteredTime, filteredData, minTime } = filteredDataInput;
    if (
      (filteredData.length === 0 || filteredTime.length === 0) &&
      (graphType === GraphType.Fees || graphType === GraphType.Volume)
    ) {
      return {
        graphType: graphType,
        timeFrame: timeFrame,
        labels: [],
        data: [],
      };
    }

    // aggregate data based on selected time
    // retrieve min time from data or default to selected view
    if (
      [
        GraphType.TVL,
        GraphType.Volume,
        GraphType.Fees,
        GraphType.Locked,
      ].includes(graphType)
    ) {
      // these three charts are bar charts, so we need to calculate buckets
      const bucketSize = (Date.now() - minTime) / 30;

      // seed empty buckets
      const emptyBuckets: Record<number, any[]> = Object.fromEntries(
        Array.from({ length: 31 }).map((_, i) => {
          const key = minTime + i * bucketSize;
          return [key, []];
        }),
      );

      const aggregatedData: Record<number, any[]> = filteredData.reduce(
        (acc, d, i) => {
          const time = filteredTime[i];
          const bucketIndex = Math.floor((time - minTime) / bucketSize);
          const key = minTime + bucketIndex * bucketSize;
          acc[key].push(d);
          return acc;
        },
        emptyBuckets,
      );
      let bucketedData;
      // interpolate TVL
      if ([GraphType.TVL, GraphType.Locked].includes(graphType)) {
        // average TVL
        let prevArr: any[] = [];
        bucketedData = Object.fromEntries(
          Object.entries(aggregatedData).map(([time, bucketArr], index) => {
            let aggregatedValue = bucketArr
              .reduce((acc, v) => acc.plus(v), new BigNumber(0))
              .div(bucketArr.length);
            // interpolate TVL by filling in missing data with latest value from previous bucket
            if (index > 0 && aggregatedValue.isNaN()) {
              aggregatedValue = prevArr[prevArr.length - 1];
            } else {
              prevArr = [...bucketArr];
            }
            return [time, aggregatedValue];
          }),
        );
      } else {
        // sum fees and volume
        bucketedData = Object.fromEntries(
          Object.entries(aggregatedData).map(([time, bucketArr]) => [
            time,
            bucketArr.reduce((acc, v) => acc.plus(v), new BigNumber(0)),
          ]),
        );
      }
      return {
        graphType: graphType,
        timeFrame: timeFrame,
        labels: Object.keys(bucketedData).map((x) => Number(x).toString()),
        data: Object.values(bucketedData).map((y) => Number(y).toString()),
      };
    }

    return {
      graphType: graphType,
      timeFrame: timeFrame,
      labels: filteredTime.map((x) => Number(x).toString()),
      data: filteredData.map((y) => Number(y).toString()),
    };
  }
}
