import { Module } from '@nestjs/common';

import { HttpService } from '@/clients/http.service';
import { MdwHttpClientService } from '@/clients/mdw-http-client.service';
import { MdwWsClientService } from '@/clients/mdw-ws-client.service';
import { SdkClientService } from '@/clients/sdk-client.service';
import { SuperheroClientService } from '@/clients/superhero-client.service';

@Module({
  providers: [
    SuperheroClientService,
    HttpService,
    MdwHttpClientService,
    MdwWsClientService,
    SdkClientService,
  ],
  exports: [
    SuperheroClientService,
    HttpService,
    MdwHttpClientService,
    MdwWsClientService,
    SdkClientService,
  ],
})
export class ClientsModule {}
