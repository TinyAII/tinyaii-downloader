import { useMemo } from 'react';
import { formatSpeed } from '../../utils/format';

// 速度曲线采样窗口（与 tasks.ts 中衰减检测保持一致）
export const SPEED_SAMPLE_LIMIT = 30;
// 衰减阈值（字节/秒），与 tasks.ts 中 SPEED_DECAY_THRESHOLD_BYTES 保持一致
export const SPEED_DECAY_THRESHOLD_BYTES = 50 * 1024;

interface SpeedSparklineProps {
  // 速度采样数组，单位：字节/秒
  data: number[];
  // 自定义高度，默认 80
  height?: number;
  // 自定义阈值（字节/秒），默认 50KB/s
  thresholdBytes?: number;
  // 重连标记位置（采样索引数组），在曲线上画橙色竖线
  markers?: number[];
}

/**
 * 速度历史曲线（近 30 秒）
 * - 绿色实线：实际速度
 * - 绿色渐变填充：速度区间
 * - 红色虚线：衰减阈值（50KB/s），跌破即可能触发重连
 * - 当采样不足 2 个时显示占位文案
 */
export default function SpeedSparkline({
  data,
  height = 80,
  thresholdBytes = SPEED_DECAY_THRESHOLD_BYTES,
  markers = [],
}: SpeedSparklineProps) {
  // 计算曲线坐标点，使用 viewBox 让宽度自适应容器
  const { points, thresholdY, peakSpeed } = useMemo(() => {
    if (data.length < 2) {
      return { points: '', thresholdY: height, peakSpeed: 0 };
    }
    // 纵轴最大值：取数据峰值与阈值的较大者，保证阈值线始终可见
    const dataMax = Math.max(...data, 0);
    const maxBytes = Math.max(dataMax, thresholdBytes) || 1;
    const width = 100;
    const stepX = width / (data.length - 1);
    const points = data
      .map((value, index) => `${(index * stepX).toFixed(2)},${(height - (value / maxBytes) * height).toFixed(2)}`)
      .join(' ');
    const thresholdY = height - (thresholdBytes / maxBytes) * height;
    return { points, thresholdY, peakSpeed: dataMax };
  }, [data, height, thresholdBytes]);

  // 计算重连标记的 x 坐标，过滤掉越界的索引
  const markerPositions = useMemo(() => {
    if (data.length < 2 || markers.length === 0) return [] as number[];
    const stepX = 100 / (data.length - 1);
    return markers
      .filter((index) => index >= 0 && index < data.length)
      .map((index) => index * stepX);
  }, [data.length, markers]);

  if (data.length < 2) {
    return (
      <div className="flex items-center justify-center text-[12px] text-text-muted" style={{ height }}>
        采集中，至少需要 2 个采样点…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <svg
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height }}
      >
        <defs>
          <linearGradient id="speedSparklineGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* 阈值线（红色虚线） */}
        <line
          x1="0"
          y1={thresholdY}
          x2="100"
          y2={thresholdY}
          stroke="#ef4444"
          strokeWidth="0.5"
          strokeDasharray="2 2"
          vectorEffect="non-scaling-stroke"
        />
        {/* 曲线填充区 */}
        <polygon
          points={`0,${height} ${points} 100,${height}`}
          fill="url(#speedSparklineGradient)"
        />
        {/* 曲线主线 */}
        <polyline
          points={points}
          fill="none"
          stroke="#10b981"
          strokeWidth="1"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        {/* 重连标记（橙色竖线） */}
        {markerPositions.map((x, i) => (
          <line
            key={`marker-${i}`}
            x1={x}
            y1="0"
            x2={x}
            y2={height}
            stroke="#f59e0b"
            strokeWidth="0.6"
            strokeDasharray="1.5 1.5"
            vectorEffect="non-scaling-stroke"
            opacity="0.75"
          />
        ))}
      </svg>
      <div className="flex items-center justify-between text-[11px] text-text-muted">
        <div className="flex items-center gap-3">
          <span>峰值 {formatSpeed(peakSpeed)}</span>
          {markerPositions.length > 0 && (
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-px bg-amber-500" />
              重连 ×{markerPositions.length}
            </span>
          )}
        </div>
        <span>阈值 {formatSpeed(thresholdBytes)}</span>
      </div>
    </div>
  );
}
