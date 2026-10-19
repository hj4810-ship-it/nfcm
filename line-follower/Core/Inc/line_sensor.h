/**
  ******************************************************************************
  * @file    line_sensor.h
  * @brief   74HC4051 八路巡线传感器：通道选择、采样、归一化、偏差计算
  ******************************************************************************
  */

#ifndef __LINE_SENSOR_H
#define __LINE_SENSOR_H

#include <stdint.h>
#include "board_config.h"

/* 所有探头在车体上的位置（用于加权平均）：最左 = -7，最右 = +7，步进 2 */
#define SENSOR_POS_SPAN         ((SENSOR_NUM - 1))
#define SENSOR_ERROR_MAX        (SENSOR_POS_SPAN * 100)   /* 偏差满量程 700 */

typedef struct
{
    uint16_t raw[SENSOR_NUM];    /* 12 位 ADC 原始值 0~4095 */
    uint16_t norm[SENSOR_NUM];   /* 归一化后的"黑度" 0~1000，1000 表示完全压黑线 */
    uint16_t min[SENSOR_NUM];    /* 该探头在白底上的读数（校准下限） */
    uint16_t max[SENSOR_NUM];    /* 该探头压黑线时的读数（校准上限） */
    uint8_t  valid[SENSOR_NUM];  /* 校准是否有效（黑白差异够大） */

    int16_t  error;              /* 位置偏差: -700(线在最左) ~ 0(居中) ~ +700(最右) */
    uint16_t active;             /* 压线探头的位掩码，bit0 = 最左探头 */
    uint8_t  count;              /* 压线探头个数 */
    uint8_t  on_line;            /* 1 = 至少有一个探头压线，0 = 丢线 */
    int8_t   last_dir;           /* 最后一次看清线时的方向: -1 左, +1 右, 0 未知 */
} LineSensor_t;

extern LineSensor_t g_sensor;

/* 初始化：把地址线置 0 并读一轮 */
void LineSensor_Init(void);

/* 用 board_config.h 里的默认表作为校准值 */
void LineSensor_SetDefaultCalib(LineSensor_t *s);

/* 自动校准：duration_ms 时间内让探头左右扫过黑线，
   每个通道分别记录最小/最大值，然后作为该通道的校准区间。
   校准期间请把小车拿在手里，让 8 个探头依次扫过黑线和白底。 */
void LineSensor_Calibrate(LineSensor_t *s, uint32_t duration_ms);

/* 把校准结果打印到串口（可直接抄进 board_config.h 的默认表） */
void LineSensor_CalibrateReport(const LineSensor_t *s);

/* 读一遍 8 路探头并算出 error / active / on_line（整轮约 0.6ms） */
void LineSensor_Scan(LineSensor_t *s);

/* 单独读某个物理通道（调试用） */
uint16_t LineSensor_ReadRaw(uint8_t ch);

#endif /* __LINE_SENSOR_H */
