#ifndef TASKS_H_
#define TASKS_H_

#include "node_state.h"

// Creates the event group, queue and the three FreeRTOS tasks:
//   vSensorTask  (priority 3) sample, decide to send, then go to deep sleep
//   vBleGattTask (priority 4) run BLE send sessions on request
//   vDisplayTask (priority 2) button handling (ISR -> task notification)
// `state` must outlive the tasks (it lives in RTC memory).
void tasksStart(NodeState &state);

#endif // TASKS_H_
