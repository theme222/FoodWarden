// End-to-end host simulation: real Sensirion VOC algorithm + real door filter.
#include <stdio.h>
#include <math.h>
#include <stdlib.h>
#include <string.h>
#include "VOCGasIndexAlgorithm.h"
#include "door_voc_filter.h"
#include "voc_algorithm.h"
static int fails=0;
#define CHECK(c,msg) do{ if(!(c)){printf("FAIL: %s\n",msg);fails++;} else printf("ok:   %s\n",msg);}while(0)
int main(){
  const float dt=5.0f;
  VOCGasIndexAlgorithm algo(dt);
  uint8_t cd=0;
  int32_t sraw_clean=30000;
  int steps=0; int32_t voc=0;
  // 1. 10 minutes of stable closed-door air (120 samples)
  for(int i=0;i<120;i++){ voc=algo.process(sraw_clean+(rand()%20-10)); uint16_t tx=doorVocFilter(cd,500,(uint16_t)voc); steps++; (void)tx; }
  printf("settled voc=%d\n",(int)voc);
  CHECK(voc>=50 && voc<=150,"baseline settles near 100 for clean air");
  // 2. door opens: sraw drops (humid air -> VOC spike), light high for 3 samples
  int masked=0, leaked=0;
  int32_t peak=0;
  for(int i=0;i<3;i++){ voc=algo.process(sraw_clean-3000); if(voc>peak)peak=voc; uint16_t tx=doorVocFilter(cd,3000,(uint16_t)voc); if(tx==VOC_NULL_SENTINEL)masked++; else leaked++; }
  printf("door open: peak voc=%d masked=%d leaked=%d\n",(int)peak,masked,leaked);
  CHECK(peak>150,"spike is real in the algorithm output");
  CHECK(masked==3 && leaked==0,"all door-open packets are masked");
  // 3. door closes, air still disturbed for 5 more samples then recovers
  int mc=0; int firstReal=-1;
  for(int i=0;i<20;i++){
    int32_t s = i<5 ? sraw_clean-2000 : sraw_clean;
    voc=algo.process(s);
    uint16_t tx=doorVocFilter(cd,500,(uint16_t)voc);
    if(tx==VOC_NULL_SENTINEL) mc++; else if(firstReal<0) firstReal=i;
  }
  printf("closed: masked=%d firstReal at packet %d\n",mc,firstReal);
  CHECK(mc==12,"exactly 12 closed-door packets masked (60 s)");
  CHECK(firstReal==12,"13th closed packet transmits real VOC");
  // 4. deep sleep, as the firmware does it (src/voc_algorithm.h): every wake is
  //    a fresh boot that processes ONE sample, with the state carried in "RTC".
  VocAlgorithmState rtc; memset(&rtc,0,sizeof rtc);   // cold boot: RTC memory zeroed
  VOCGasIndexAlgorithm ref(dt);                         // never sleeps, for comparison
  int32_t w=0, r=0, firstNonZero=-1;
  for(int wake=0;wake<240;wake++){                      // 20 minutes of 5 s wakes
    int32_t s = sraw_clean+(rand()%20-10);
    VocAlgorithmState boot = rtc;                       // what survives deep sleep
    vocAlgorithmBegin(boot,dt);
    w = vocAlgorithmProcess(boot,s);
    rtc = boot;
    r = ref.process(s);
    if(w>0 && firstNonZero<0) firstNonZero=wake;
  }
  printf("per-wake restore: voc=%d (never-sleeping reference %d), first index at wake %d\n",(int)w,(int)r,(int)firstNonZero);
  CHECK(firstNonZero>=0 && firstNonZero<=12,"index leaves the 45 s blackout once, not on every wake");
  CHECK(w==r,"one sample per boot with RTC state matches a never-sleeping algorithm exactly");
  CHECK(w>=50 && w<=150,"per-wake baseline settles near 100 for clean air");
  printf("%s (%d failures)\n",fails?"SIM FAILED":"SIM PASSED",fails);
  return fails;
}
