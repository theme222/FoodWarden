# Embedded System (CEDT) – Final Project 2026: Smart Devices

## 1 Objectives

In the final project, you will apply your knowledge of embedded systems, your creativity and your project-management skills to build a smart device. You will use microcontrollers (ESP32 or similar) to read data from sensors and drive actuators, pass that data from a sensor node to a gateway, connect to the Internet and the cloud, and use AI to make decisions that control the device.

This year, the project puts more weight on embedded engineering quality (how well the firmware is designed, how reliable the communication is, and how well you measure the system's real performance) rather than on how many features you add.

You choose what your smart device does under the theme "Smart Devices". Examples include environmental monitoring, health and elderly care, energy saving, waste reduction and campus services. Sensors and actuators can be borrowed from the course; if what you need is not available, you buy it yourself. Borrowed equipment must be returned in working condition after the final presentation. You can consult us if you need additional sensors.

You will work in a group of 3–5 students. Each member takes at least one role in Section 3.

## 2 Background

### 2.1 Smart Devices

A smart device is an electronic device, generally connected to other devices or networks via wireless protocols (such as Bluetooth, Zigbee, NFC, Wi-Fi or 5G), that can operate to some extent interactively and autonomously. Examples include smart speakers, smart thermostats, smart doorbells, smart locks, smartwatches and many others. The term can also refer to a device that exhibits properties of ubiquitous computing, including, although not necessarily, machine learning. *[Excerpt from Wikipedia]*

### 2.2 Cloud and IoT Platforms

You may use any IoT/cloud platform, for example NETPIE (https://netpie.io, NECTEC's IoT platform for Thailand), Firebase, ThingSpeak, Blynk, Google Sheets, or your own MQTT broker and database. If you follow online tutorials for NETPIE, check that they are for the current version (NETPIE2020); older tutorials use an API that no longer works.

### 2.3 Definitions Used in This Document

- **Sensor node:** a board that mainly collects data from its own sensors. It does not send data to the cloud directly; it sends data to the gateway.
- **Gateway:** a board (ESP32, Raspberry Pi or similar) that collects data from sensor nodes and from its own sensors, processes it in real time, controls actuators, and forwards data to the cloud. You may use one ESP32 as the sensor node and another ESP32 as the gateway, or other boards. The sensor node and the gateway may communicate over any link, such as Wi-Fi, ESP-NOW, Bluetooth or UART.
- **Gateway sensors:** the gateway must have its own sensors wired to it, in addition to the data it receives from sensor nodes.
- **Sensor location:** a sensor module (including I2C/SPI modules) counts toward the board it is wired to.
- **Sensor type:** each distinct sensing component counts as one type. A module that measures two quantities (e.g. DHT22 temperature and humidity) counts as one type, and two identical sensors also count as one type.
- **Off-the-shelf products:** finished commercial devices (e.g. a commercial smart plug or IP camera) do not count toward the sensor or actuator requirements. Sensors and actuators must be wired to and controlled by your own sensor node or gateway.
- **Actuator:** a device that produces physical motion or physical action, such as a DC motor, servo motor, stepper motor, pump, solenoid valve, solenoid lock or linear actuator. The following do not count as actuators: LED, RGB LED, buzzer, speaker (including a speaker that talks back), display, IR/RF transmitter.
- **Cloud storage:** a service that stores your raw sensor data and lets you read it back (e.g. NETPIE, Firebase, ThingSpeak, Google Sheets). A calendar service alone does not count.
- **AI component:** an AI model that processes camera, microphone or sensor data and makes a decision. You may use an open-source or pre-trained model; you do not have to train your own. The input does not have to come from a camera or microphone; sensor data is fine. Fixed thresholds or if-else rules are not an AI component. Calling an LLM or vision model through a cloud API is allowed. The model may run on the MCU, the gateway, a computer, a mobile device or a cloud API (running it on the MCU itself earns item E7 in Section 5).

## 3 Groups and Roles

Groups have 3–5 members; a group with fewer than 3 members needs the instructor's approval. Groups with more than 5 members incur a penalty of −2.5 points per additional member. Each member must take at least one of the following roles (in a group of 3, members may combine roles):

1. **System Architect & Integration:** designs the overall system, data flow and message format, and integrates all parts.
2. **Embedded Developer (Sensor Node):** develops the firmware on the sensor node(s).
3. **Embedded Developer (Gateway & Cloud):** develops the gateway firmware, real-time processing and cloud connection.
4. **UI/UX & Dashboard Developer:** designs and develops the dashboard, mobile/web app and alerts.
5. **Project Manager & Test Lead:** manages the timeline, plans the tests and collects the performance metrics.

The roles of all members must be written in the proposal and the final report, and each member's work must appear in the Git commit history.

## 4 Requirements

### 4.1 Minimum Requirements (Pass/Fail)

Every project must meet all of the following. These items carry no points; instead, **2 points are deducted from the total for each item that is missing.**

| # | Minimum requirement |
|---|---|
| M1 | At least 5 different sensor types in total, with at least 2 on the sensor node and at least 2 on the gateway |
| M2 | At least 1 actuator (see definition in 2.3) |
| M3 | Wired or wireless data transmission from the sensor node to the gateway |
| M4 | An AI component that processes camera, microphone or sensor data, and whose output is used to control an actuator or make a decision in the system (closed loop) |
| M5 | Raw data uploaded to at least 1 cloud storage platform, with a dashboard |
| M6 | A notification system (e.g. LINE, email, Discord, Telegram) for important events or system status |
| M7 | Meets the safety rules in 4.3 |
| M8 | A Git repository accessible from the Internet, with commit history from every member |

### 4.2 Choosing a Topic

- Register your topic and group in the topic sheet (link on MyCourseVille) by **Saturday 24 October 2026**. Topics are first-come, first-served: if your idea is already registered, you must state clearly how yours is different. The instructor approves each topic at the proposal stage.
- Topics that were very common last year (plant watering/plant care, smart bin, smart curtain, smart parking, smart door/lock, general smart home) are allowed only with a clearly new angle, a real user, or a real deployment site stated in the proposal.
- The problem should affect a real group of users. Projects with a real problem owner (e.g. a unit on campus, a community, a company or a family member with a real need) are encouraged.

### 4.3 Safety Rules

- Mains voltage (220 V AC) may be switched only through an enclosed, certified relay/SSR module or smart plug. No exposed mains wiring. Any device that uses mains voltage must be checked by a TA or instructor before the demo.
- Keep liquids (pumps, water tanks) physically separated from electronics, and use a tray or enclosure to catch spills.
- Lithium batteries must have a protection circuit and must not be left charging unattended.
- Moving parts (motors, doors, locks) must have a way to stop safely (limit switch, timeout or manual stop).

### 4.4 Milestones

| Date | Milestone | What to submit (via MyCourseVille) |
|---|---|---|
| Sat 17 Oct 2026 | Project release | – |
| Sat 24 Oct 2026 | Group and topic registration | Group name, members, topic in the topic sheet |
| Fri 30 Oct 2026 | Proposal | 1–2 pages: problem and target users, block diagram (sensor node / gateway / cloud / dashboard), list of sensors and actuators (BOM), chosen Embedded Engineering Depth items (Section 5, II′), role of each member |
| Fri 20 Nov 2026 | Checkpoint video | Progress video (≤2 min) showing data flowing end to end: sensor node → gateway → cloud → dashboard |
| Tue 8 Dec 2026 | Final presentation and demo | See 4.5 |

Milestone deadlines are at 23:59 on the date shown. A milestone that is missing or more than 24 hours late deducts 2 points from the total.

### 4.5 Final Submission

On Tuesday 8 December 2026, each group presents for 10 minutes (including a live demo), followed by Q&A. Book your presentation slot in the booking sheet (link will be announced on MyCourseVille). Bring your own mobile hotspot, because the university Wi-Fi often does not work with ESP32 boards. If the live demo fails, you may show a backup video, but the Demonstration score will be lower.

Submit the following on MyCourseVille by **23:59 on Tuesday 8 December 2026** (no penalty for submissions received by 06:00 on Wednesday 9 December 2026; after that, 5 points are deducted from the total for each additional day or part of a day late):

1. Presentation slides.
2. Final report (PDF), at most 10 pages, excluding cover page, table of contents, preface, references and appendix. English or Thai.
3. Video (3–5 minutes) uploaded to YouTube, Facebook, TikTok or similar, with the link.
4. Source code: an archive of the source code plus the link to your Git repository. The repository must be accessible from the Internet. Do not commit Wi-Fi passwords, API keys or tokens.
5. Peer evaluation: each member submits individually (form on MyCourseVille).

### 4.6 AI Tools and Academic Integrity

- You may use AI coding tools (e.g. ChatGPT, Claude, GitHub Copilot). Declare clearly in the report which tools you used and for which parts of the system.
- Every member must be able to explain the code and design of their own part. Code that you cannot explain during Q&A may receive no credit.
- Code, libraries or designs from other people, including previous years' projects, must be cited in the report and the repository. Submitting another group's work as your own is not allowed.

## 5 Marking Guide (70 Points)

### I. Problem Definition (5 points)

- **Relevance and Impact (3 points):** Clearly describes a real-world problem affecting a significant group of people and justifies its urgency. The problem is well-defined and appropriately scoped for an embedded systems project.
- **Evidence and Detail (2 points):** Provides background, context and evidence (data, user interviews, observations or a real problem owner) to understand the problem and the proposed solution.

### II. System Architecture and Scalability (5 points)

- **Architecture and Data Flow (2 points):** Clear overview diagram; defined message format between sensor node, gateway and cloud; real-time processing on the gateway for immediate control actions.
- **Scalability (3 points):**
  - 1 point: the message format and gateway code support multiple sensor nodes (e.g. node ID in every message), shown in code.
  - 2 points: 1 physical sensor node plus at least 2 simulated sensor nodes running at the same time, each identified correctly by the gateway and the dashboard.
  - 3 points: at least 2 physical sensor nodes running at the same time.

### II′. Embedded Engineering Depth (10 points)

Choose items from the menu below. Each item is worth 2 points (1 point if it only partly works or you cannot fully explain it), up to a maximum of 10 points (5 items). You may implement more than 5 items, but the score is capped at 10. Each item counts only if you demonstrate it and explain how you implemented it (in the report and when asked during Q&A). State the items you plan to do in the proposal. You may change the items later; explain the change in the report.

| # | Item | What counts |
|---|---|---|
| E1 | RTOS multitasking | FreeRTOS with at least 3 tasks with reasoned priorities, communicating through queues, semaphores or event groups |
| E2 | Interrupt-driven I/O | At least one input handled by an ISR with deferred processing (no busy polling) |
| E3 | Low power | Deep/light sleep with measured current consumption and an estimated battery life |
| E4 | Reliable communication | Acknowledgement/retry between node and gateway, and store-and-forward (buffering) when the Internet or cloud is down |
| E5 | Security | Encrypted and authenticated connection to the cloud (e.g. MQTT over TLS with credentials); no secrets committed to the repository |
| E6 | OTA update | Firmware update over the air, demonstrated |
| E7 | On-device AI | An AI model running on the MCU itself (e.g. ESP32-S3 with TinyML, ESP-DL or Edge Impulse) |
| E8 | Low-level driver or protocol | Your own driver for a sensor/peripheral at register or bus level (I2C/SPI/UART), or a multi-hop/mesh protocol across 3 or more nodes (e.g. ESP-NOW mesh, LoRa). A simple point-to-point link used for M3 does not count. |

### III. Implementation (20 points)

- **Functionality (8 points):**
  - Core functionality (up to 4 points): scored by how many of the core features are implemented and demonstrable.
  - Complete functionality (+4 points): all designed features are fully implemented and work as intended.
- **Field Testing (3 points):**
  - 1: minimal test in your own environment.
  - 2: continuous test in your own environment with continuous data collection (at least 24 hours).
  - 3: tested with actual users or at a real site. Deployment in more than one location strengthens this level.
- **Robustness (3 points):**
  - 1: works sometimes.
  - 2: works nearly all the time.
  - 3: works every time under all tested conditions, and recovers by itself after a power or Wi-Fi loss.
- **Build Quality (3 points),** covering organization, aesthetics and portability:
  - 1: just a working prototype.
  - 2: properly put in a model or enclosure; can be moved with care.
  - 3: neat wiring and installation in a good-looking enclosure; easily transported and set up without damage.
- **User Experience (3 points),** covering the dashboard/app and alerts:
  - 1: some effort to make the interface look good and usable.
  - 2: a clear, well-organized interface (a well-arranged Blynk/NETPIE dashboard is acceptable).
  - 3: intuitive and attractive; requires minimal instruction; alerts are clear and useful.

### IV. Testing and Analysis (10 points)

- **Test Plan and Procedure (3 points):** Documented test procedures that cover normal use, edge cases and failure conditions (e.g. Wi-Fi loss, sensor unplugged, power loss). 1: some cases tested; 2: normal use and edge cases; 3: also failure conditions, with documented steps and results.
- **Quantitative Metrics (4 points):** Measure at least 3 of the following with real data, stating how you measured each one: end-to-end latency (sensor → dashboard or sensor → actuator), packet delivery rate between node and gateway, sensor accuracy compared with a reference instrument, power consumption or battery life, AI accuracy (or precision/recall) on your own test data, uptime over a continuous run. Scoring: 1 point per metric measured with real data and a stated method (up to 3), plus 1 point when measurements are repeated and reported with their variation (e.g. mean and min/max).
- **Analysis and Comparison (3 points):** Results are analyzed and compared against your project objectives and against existing similar products or systems. 1: compared with your objectives; 2: also compared with existing systems; 3: both, using your measured metrics.

### V. Presentation (10 points)

The presenter may be chosen at random by the examiner, so every member must prepare.

- **Clarity and Organization (2 points):** Logical flow that communicates the project's purpose, design and results.
- **Delivery (2 points):** Clear voice, appropriate body language and minimal reading from slides.
- **Slides (1 point):** Well-organized slides that support the presentation.
- **Demonstration (2 points):** A live demonstration with a clear plan and explanation of the setup and procedure.
- **Individual Q&A (3 points):** The examiner asks members chosen at random technical questions about their own part of the system (firmware, protocol, gateway, dashboard or tests). This is a group score, but a member whose answers differ greatly from the rest of the group may receive a different score.

### VI. Video and Documentation (10 points)

- **Video (4 points),** 3–5 minutes:
  - Content (2 points): identifies team members and university affiliation, gives a concise project overview, shows the system working and explains the key components.
  - Quality (2 points): well-produced and visually clear, and uploaded to a public platform (an unlisted link is acceptable).
- **Report (6 points):** at most 10 pages (pages beyond the limit are not graded), 1 point for each of the following parts:
  - Introduction and problem statement
  - Related work and similar solutions (with references)
  - System design: overview diagram, sensor node, gateway, cloud/storage, dashboard and message format
  - Test results and performance metrics
  - Discussion and conclusion
  - Role and contribution of each member, the link to the Git repository, and the AI tool declaration (Section 4.6)

### VII. Deductions and Individual Scores

- Missing minimum requirement (Section 4.1): −2 points per item.
- Missing or late milestone (Section 4.4): −2 points per milestone.
- More than 5 members: −2.5 points per additional member.
- Late final submission (Section 4.5): −5 points per day or part of a day after the grace period.
- The total score cannot go below 0.
- Individual score = group score × peer factor. The peer factor is between 0.8 and 1.0. It comes from the peer evaluation and the Git commit history. It is normally 1.0; it is reduced only when the evidence shows that a member contributed clearly less than the others. A member with no verifiable contribution may receive 0 for the project.

**Total:** 70 points (I 5 + II 5 + II′ 10 + III 20 + IV 10 + V 10 + VI 10), scaled to 35% of the course grade.

## 6 Timeline

| Date | Event |
|---|---|
| Sat 17 Oct 2026 | Project release |
| Sat 24 Oct 2026 | Group and topic registration |
| Fri 30 Oct 2026 | Proposal due |
| Fri 20 Nov 2026 | Checkpoint progress video (end-to-end data flow) |
| Tue 8 Dec 2026 | Final presentation; all submissions due 23:59 |
| Wed 9 Dec 2026, 06:00 | Grace period ends; −5 points per day late after this |

## 7 FAQ

Students can ask further questions in the Q&A tab. *(The original text layer was garbled during extraction; this is the intended Thai sentence: นิสิตสามารถสอบถามเพิ่มเติมได้ใน Tab Q&A.)*
