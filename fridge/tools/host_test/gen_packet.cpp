#include <stdio.h>
#include <string.h>
#include "crypto.h"
int main(){
  uint8_t key[16]; for(int i=0;i<16;i++) key[i]=i;
  uint8_t salt[8]={0xA1,0xB2,0xC3,0xD4,0xE5,0xF6,0x07,0x18};
  SensorSample s[6];
  for(int i=0;i<6;i++){ s[i].timestamp_s=1767225600ULL+i*5; s[i].temp_cdeg=(int16_t)(342+i); s[i].voc_index=(i==2)?VOC_NULL_SENTINEL:(uint16_t)(100+i); s[i].light_ldr=(uint16_t)(10+i); }
  s[5].temp_cdeg=SENSOR_TEMP_ERROR;
  const uint8_t counts[]={1,6};
  for(uint8_t c: counts){
    uint8_t out[TELEMETRY_MAX_PACKET_LEN]; size_t n=buildEncryptedPacket(key,"F0",salt,0x01020304u,s,c,out,sizeof out);
    printf("N=%u len=%zu expected=%zu\n",c,n,(size_t)(32+c*14));
    for(size_t i=0;i<n;i++) printf("%02x",out[i]); printf("\n");
  }
  uint8_t small[10];
  printf("bad_count0=%zu bad_count7=%zu small_buf=%zu\n",
    buildEncryptedPacket(key,"F0",salt,1,s,0,small,sizeof small),
    buildEncryptedPacket(key,"F0",salt,1,s,7,small,sizeof small),
    buildEncryptedPacket(key,"F0",salt,1,s,6,small,sizeof small));
  return 0;
}
