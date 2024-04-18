import { Test, TestingModule } from '@nestjs/testing';

import { MdwHttpClientService } from '@/clients/mdw-http-client.service';
import { SdkClientService } from '@/clients/sdk-client.service';
import { PairDbService } from '@/database/pair/pair-db.service';
import { PairLiquidityInfoHistoryV2DbService } from '@/database/pair-liquidity-info-history/pair-liquidity-info-history-v2-db.service';
import { PairLiquidityInfoHistoryV2ErrorDbService } from '@/database/pair-liquidity-info-history-error/pair-liquidity-info-history-v2-error-db.service';
import { bigIntToDecimal } from '@/lib/utils';
import {
  EventType,
  PairLiquidityInfoHistoryImporterV2Service,
} from '@/tasks/pair-liquidity-info-history-importer/pair-liquidity-info-history-importer-v2.service';
import resetAllMocks = jest.resetAllMocks;
import {
  contractLog1,
  contractLog2,
  contractLog3,
  contractLog4,
  contractLog5,
  contractLog6,
  contractLog7,
  contractLog8,
  initialMicroBlock,
  pairContract,
  pairWithTokens,
} from '@/test/mock-data/pair-liquidity-info-history-mock-data';

const mockMdwClient = {
  getContract: jest.fn(),
  getMicroBlock: jest.fn(),
  getContractLogsUntilCondition: jest.fn(),
};

const mockPairDb = { getAll: jest.fn() };

const mockPairLiquidityInfoHistoryV2Db = {
  getLastlySyncedLogByPairId: jest.fn(),
  upsert: jest.fn(),
};

const mockPairLiquidityInfoHistoryV2ErrorDb = {
  getErrorWithinHours: jest.fn(),
  upsert: jest.fn(),
};

describe('PairLiquidityInfoHistoryImporterV2Service', () => {
  let service: PairLiquidityInfoHistoryImporterV2Service;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PairLiquidityInfoHistoryImporterV2Service,
        { provide: MdwHttpClientService, useValue: mockMdwClient },
        { provide: PairDbService, useValue: mockPairDb },
        {
          provide: PairLiquidityInfoHistoryV2DbService,
          useValue: mockPairLiquidityInfoHistoryV2Db,
        },
        {
          provide: PairLiquidityInfoHistoryV2ErrorDbService,
          useValue: mockPairLiquidityInfoHistoryV2ErrorDb,
        },
        SdkClientService,
      ],
    }).compile();
    service = module.get<PairLiquidityInfoHistoryImporterV2Service>(
      PairLiquidityInfoHistoryImporterV2Service,
    );
    resetAllMocks();
  });

  describe('import', () => {
    it('should import liquidity correctly', async () => {
      // Mock functions
      mockPairDb.getAll.mockResolvedValue([pairWithTokens]);
      mockPairLiquidityInfoHistoryV2ErrorDb.getErrorWithinHours.mockResolvedValue(
        undefined,
      );
      mockPairLiquidityInfoHistoryV2Db.getLastlySyncedLogByPairId
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({
          reserve0: bigIntToDecimal(100n),
          reserve1: bigIntToDecimal(100n),
        });
      mockMdwClient.getContract.mockResolvedValue(pairContract);
      mockMdwClient.getMicroBlock.mockResolvedValue(initialMicroBlock);
      mockPairLiquidityInfoHistoryV2Db.upsert.mockResolvedValue(null);
      mockMdwClient.getContractLogsUntilCondition.mockResolvedValue([
        contractLog1,
        contractLog2,
        contractLog3,
        contractLog4,
        contractLog5,
        contractLog6,
        contractLog7,
        contractLog8,
      ]);

      // Spies
      const logSpy = jest.spyOn(service.logger, 'log');

      // Start import
      await service.import();

      // Assertions
      expect(
        mockPairLiquidityInfoHistoryV2ErrorDb.getErrorWithinHours,
      ).toHaveBeenCalledTimes(5); // Once for pair and 4 times for each inserted event

      expect(logSpy.mock.calls).toEqual([
        ['Started syncing pair liquidity info history.'],
        ['Syncing liquidity info history for 1 pairs.'],
        [
          `Inserted initial liquidity for pair ${pairWithTokens.id} ${pairWithTokens.address}.`,
        ],
        [
          `Completed sync for pair ${pairWithTokens.id} ${pairWithTokens.address}. Synced 4 log(s).`,
        ],
        ['Finished liquidity info history sync for all pairs.'],
      ]);

      expect(mockPairLiquidityInfoHistoryV2Db.upsert).toHaveBeenCalledTimes(5);
      expect(mockPairLiquidityInfoHistoryV2Db.upsert.mock.calls).toEqual([
        [
          {
            pairId: pairWithTokens.id,
            eventType: 'CreatePair',
            reserve0: bigIntToDecimal(0n),
            reserve1: bigIntToDecimal(0n),
            deltaReserve0: bigIntToDecimal(0n),
            deltaReserve1: bigIntToDecimal(0n),
            fiatPrice: bigIntToDecimal(0n),
            height: parseInt(initialMicroBlock.height),
            microBlockHash: initialMicroBlock.hash,
            microBlockTime: BigInt(initialMicroBlock.time),
            transactionHash: pairContract.source_tx_hash,
            transactionIndex: 0n,
            logIndex: 0,
          },
        ],
        [
          {
            pairId: pairWithTokens.id,
            eventType: EventType.PairMint,
            reserve0: bigIntToDecimal(100n),
            reserve1: bigIntToDecimal(100n),
            deltaReserve0: bigIntToDecimal(100n),
            deltaReserve1: bigIntToDecimal(100n),
            fiatPrice: bigIntToDecimal(0n),
            height: parseInt(contractLog2.height),
            microBlockHash: contractLog2.block_hash,
            microBlockTime: BigInt(contractLog2.block_time),
            transactionHash: contractLog2.call_tx_hash,
            transactionIndex: BigInt(contractLog2.call_txi),
            logIndex: parseInt(contractLog2.log_idx),
          },
        ],
        [
          {
            pairId: pairWithTokens.id,
            eventType: EventType.Sync,
            reserve0: bigIntToDecimal(200n),
            reserve1: bigIntToDecimal(200n),
            deltaReserve0: bigIntToDecimal(100n),
            deltaReserve1: bigIntToDecimal(100n),
            fiatPrice: bigIntToDecimal(0n),
            height: parseInt(contractLog3.height),
            microBlockHash: contractLog3.block_hash,
            microBlockTime: BigInt(contractLog3.block_time),
            transactionHash: contractLog3.call_tx_hash,
            transactionIndex: BigInt(contractLog3.call_txi),
            logIndex: parseInt(contractLog3.log_idx),
          },
        ],
        [
          {
            pairId: pairWithTokens.id,
            eventType: EventType.SwapTokens,
            reserve0: bigIntToDecimal(201n),
            reserve1: bigIntToDecimal(199n),
            deltaReserve0: bigIntToDecimal(1n),
            deltaReserve1: bigIntToDecimal(-1n),
            fiatPrice: bigIntToDecimal(0n),
            height: parseInt(contractLog5.height),
            microBlockHash: contractLog5.block_hash,
            microBlockTime: BigInt(contractLog5.block_time),
            transactionHash: contractLog5.call_tx_hash,
            transactionIndex: BigInt(contractLog5.call_txi),
            logIndex: parseInt(contractLog5.log_idx),
          },
        ],
        [
          {
            pairId: pairWithTokens.id,
            eventType: EventType.PairBurn,
            reserve0: bigIntToDecimal(100n),
            reserve1: bigIntToDecimal(100n),
            deltaReserve0: bigIntToDecimal(-101n),
            deltaReserve1: bigIntToDecimal(-99n),
            fiatPrice: bigIntToDecimal(0n),
            height: parseInt(contractLog7.height),
            microBlockHash: contractLog7.block_hash,
            microBlockTime: BigInt(contractLog7.block_time),
            transactionHash: contractLog7.call_tx_hash,
            transactionIndex: BigInt(contractLog7.call_txi),
            logIndex: parseInt(contractLog5.log_idx),
          },
        ],
      ]);
    });

    it('should skip a pair if there was a recent error', async () => {
      // Mock functions
      mockPairDb.getAll.mockResolvedValue([pairWithTokens]);
      mockPairLiquidityInfoHistoryV2ErrorDb.getErrorWithinHours.mockResolvedValue(
        {
          id: 1,
          pairId: 1,
          microBlockHash: '',
          transactionHash: '',
          logIndex: -1,
          error: 'error',
          timesOccurred: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      );

      // Spies
      const logSpy = jest.spyOn(service.logger, 'log');

      // Start import
      await service.import();

      // Assertions
      expect(logSpy.mock.calls).toEqual([
        ['Started syncing pair liquidity info history.'],
        ['Syncing liquidity info history for 1 pairs.'],
        [`Skipped pair ${pairWithTokens.id} due to recent error.`],
        ['Finished liquidity info history sync for all pairs.'],
      ]);
    });

    it('should skip a log if there was a recent error', async () => {
      // Mock functions
      mockPairDb.getAll.mockResolvedValue([pairWithTokens]);
      mockPairLiquidityInfoHistoryV2ErrorDb.getErrorWithinHours
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({
          id: 1,
          pairId: 1,
          microBlockHash: contractLog1.block_hash,
          transactionHash: contractLog1.call_tx_hash,
          logIndex: contractLog1.log_idx,
          error: 'error',
          timesOccurred: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        })
        .mockResolvedValueOnce(undefined);
      mockPairLiquidityInfoHistoryV2Db.getLastlySyncedLogByPairId.mockResolvedValue(
        {},
      );
      mockPairLiquidityInfoHistoryV2Db.upsert.mockResolvedValue(null);
      mockMdwClient.getContractLogsUntilCondition.mockResolvedValue([
        contractLog1,
        contractLog2,
        contractLog4,
        contractLog5,
      ]);

      // Spies
      const logSpy = jest.spyOn(service.logger, 'log');

      // Start import
      await service.import();

      // Assertions
      expect(
        mockPairLiquidityInfoHistoryV2ErrorDb.getErrorWithinHours,
      ).toHaveBeenCalledTimes(3); // Once for pair and 2 times for each event

      expect(logSpy.mock.calls).toEqual([
        ['Started syncing pair liquidity info history.'],
        ['Syncing liquidity info history for 1 pairs.'],
        [
          `Skipped log with block hash ${contractLog1.block_hash} tx hash ${contractLog1.call_tx_hash} and log index ${contractLog1.log_idx} due to recent error.`,
        ],
        [
          `Completed sync for pair ${pairWithTokens.id} ${pairWithTokens.address}. Synced 1 log(s).`,
        ],
        ['Finished liquidity info history sync for all pairs.'],
      ]);

      expect(mockPairLiquidityInfoHistoryV2Db.upsert.mock.calls).toEqual([
        [
          {
            pairId: pairWithTokens.id,
            eventType: EventType.SwapTokens,
            reserve0: bigIntToDecimal(201n),
            reserve1: bigIntToDecimal(199n),
            deltaReserve0: bigIntToDecimal(1n),
            deltaReserve1: bigIntToDecimal(-1n),
            fiatPrice: bigIntToDecimal(0n),
            height: parseInt(contractLog5.height),
            microBlockHash: contractLog5.block_hash,
            microBlockTime: BigInt(contractLog5.block_time),
            transactionHash: contractLog5.call_tx_hash,
            transactionIndex: BigInt(contractLog5.call_txi),
            logIndex: parseInt(contractLog5.log_idx),
          },
        ],
      ]);
    });

    it('should catch and insert an error on pair level', async () => {
      const error = {
        pairId: pairWithTokens.id,
        microBlockHash: '',
        transactionHash: '',
        logIndex: -1,
        error: 'Error: error',
      };

      // Mock functions
      mockPairDb.getAll.mockResolvedValue([pairWithTokens]);
      mockPairLiquidityInfoHistoryV2ErrorDb.getErrorWithinHours.mockResolvedValue(
        undefined,
      );
      mockPairLiquidityInfoHistoryV2Db.getLastlySyncedLogByPairId.mockResolvedValue(
        {},
      );
      mockMdwClient.getContractLogsUntilCondition.mockRejectedValue(
        new Error('error'),
      );
      mockPairLiquidityInfoHistoryV2ErrorDb.upsert.mockResolvedValue(null);

      // Spies
      const logSpy = jest.spyOn(service.logger, 'log');
      const errorSpy = jest.spyOn(service.logger, 'error');

      // Start import
      await service.import();

      // Assertions
      expect(mockPairLiquidityInfoHistoryV2ErrorDb.upsert).toHaveBeenCalledWith(
        error,
      );

      expect(logSpy.mock.calls).toEqual([
        ['Started syncing pair liquidity info history.'],
        ['Syncing liquidity info history for 1 pairs.'],
        ['Finished liquidity info history sync for all pairs.'],
      ]);

      expect(errorSpy.mock.calls).toEqual([
        [`Skipped pair. ${JSON.stringify(error)}`],
      ]);
    });

    it('should catch and insert an error on log level', async () => {
      const error = {
        pairId: pairWithTokens.id,
        microBlockHash: contractLog3.block_hash,
        transactionHash: contractLog3.call_tx_hash,
        logIndex: parseInt(contractLog3.log_idx),
        error: 'Error: error',
      };

      // Mock functions
      mockPairDb.getAll.mockResolvedValue([pairWithTokens]);
      mockPairLiquidityInfoHistoryV2ErrorDb.getErrorWithinHours.mockResolvedValue(
        undefined,
      );
      mockPairLiquidityInfoHistoryV2Db.getLastlySyncedLogByPairId
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error('error'))
        .mockRejectedValueOnce(undefined);
      mockMdwClient.getContractLogsUntilCondition.mockResolvedValue([
        contractLog3,
        contractLog4,
        contractLog5,
      ]);
      mockPairLiquidityInfoHistoryV2Db.upsert.mockResolvedValue(null);
      mockPairLiquidityInfoHistoryV2ErrorDb.upsert.mockResolvedValue(null);
      const logSpy = jest.spyOn(service.logger, 'log');
      const errorSpy = jest.spyOn(service.logger, 'error');

      // Start import
      await service.import();

      // Assertions
      expect(mockPairLiquidityInfoHistoryV2ErrorDb.upsert).toHaveBeenCalledWith(
        error,
      );

      expect(logSpy.mock.calls).toEqual([
        ['Started syncing pair liquidity info history.'],
        ['Syncing liquidity info history for 1 pairs.'],
        [
          `Completed sync for pair ${pairWithTokens.id} ${pairWithTokens.address}. Synced 1 log(s).`,
        ],
        ['Finished liquidity info history sync for all pairs.'],
      ]);

      expect(errorSpy.mock.calls).toEqual([
        [`Skipped log. ${JSON.stringify(error)}`],
      ]);

      expect(mockPairLiquidityInfoHistoryV2Db.upsert.mock.calls).toEqual([
        [
          {
            pairId: pairWithTokens.id,
            eventType: EventType.SwapTokens,
            reserve0: bigIntToDecimal(201n),
            reserve1: bigIntToDecimal(199n),
            deltaReserve0: bigIntToDecimal(1n),
            deltaReserve1: bigIntToDecimal(-1n),
            fiatPrice: bigIntToDecimal(0n),
            height: parseInt(contractLog5.height),
            microBlockHash: contractLog5.block_hash,
            microBlockTime: BigInt(contractLog5.block_time),
            transactionHash: contractLog5.call_tx_hash,
            transactionIndex: BigInt(contractLog5.call_txi),
            logIndex: parseInt(contractLog5.log_idx),
          },
        ],
      ]);
    });
  });
});