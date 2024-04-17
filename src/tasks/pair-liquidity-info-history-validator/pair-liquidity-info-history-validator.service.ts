import { Injectable, Logger } from '@nestjs/common';
import { uniq } from 'lodash';

import { MdwHttpClientService } from '@/clients/mdw-http-client.service';
import { MicroBlockHash } from '@/clients/sdk-client.model';
import { SdkClientService } from '@/clients/sdk-client.service';
import { PairLiquidityInfoHistoryDbService } from '@/database/pair-liquidity-info-history/pair-liquidity-info-history-db.service';

@Injectable()
export class PairLiquidityInfoHistoryValidatorService {
  constructor(
    private mdwClient: MdwHttpClientService,
    private pairLiquidityInfoHistoryDb: PairLiquidityInfoHistoryDbService,
    private sdkClient: SdkClientService,
  ) {}

  readonly logger = new Logger(PairLiquidityInfoHistoryValidatorService.name);

  async validate() {
    this.logger.log(`Started validating pair liquidity info history.`);

    // Get current height
    const currentHeight = await this.sdkClient.getHeight();

    // Get all liquidity entries greater or equal the current height minus 20
    const liquidityEntriesWithinHeightSorted =
      await this.pairLiquidityInfoHistoryDb.getWithinHeightSorted(
        currentHeight - 20,
      );

    // Get unique keyBlocks from entries
    const uniqueHeights = uniq(
      liquidityEntriesWithinHeightSorted.map((e) => e.height),
    );

    // Fetch microBlocks for these unique keyBlocks from mdw
    const microBlockHashsOnMdw = (
      await Promise.all(
        uniqueHeights.map((h) => this.mdwClient.getKeyBlockMicroBlocks(h)),
      )
    )
      .flat()
      .map((mb) => mb.hash);

    // If a local microBlock is not contained in the mdw, delete this block and all newer entries
    let numDeleted = 0;
    for (const liquidityEntry of liquidityEntriesWithinHeightSorted) {
      if (
        !microBlockHashsOnMdw.includes(
          liquidityEntry.microBlockHash as MicroBlockHash,
        )
      ) {
        numDeleted = (
          await this.pairLiquidityInfoHistoryDb.deleteFromMicroBlockTime(
            liquidityEntry.microBlockTime,
          )
        ).count;
        break;
      }
    }

    if (numDeleted > 0) {
      this.logger.log(
        `Found an inconsistency in pair liquidity info history. Deleted ${numDeleted} entries.`,
      );
    } else {
      this.logger.log('No problems in pair liquidity info history found.');
    }

    this.logger.log('Finished validating pair liquidity info history.');
  }
}