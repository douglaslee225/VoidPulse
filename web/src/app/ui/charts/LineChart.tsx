import {
  CategoryScale,
  Chart as ChartJS,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
  TooltipItem,
} from "chart.js";
import React, { useState } from "react";
import { Line } from "react-chartjs-2";
import { useCurrTheme } from "../../themes/useCurrTheme";
import { ChartTooltip, TooltipData } from "./ChartTooltip";
import {
  ChartTooltipInfo,
  GetTooltipData,
  createExternalTooltipHandler,
} from "../../utils/createExternalTooltipHandler";
import { useChartTooltip } from "./useChartTooltip";

// Register ChartJS components using ChartJS.register
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip
);

interface LineChartProps {
  disableAnimations?: boolean;
  data: any;
  yPercent?: boolean;
  getTooltipData: GetTooltipData;
}

export const LineChart: React.FC<LineChartProps> = ({
  data,
  disableAnimations,
  yPercent,
  getTooltipData,
}) => {
  const { theme } = useCurrTheme();
  const { external, tooltipNode } = useChartTooltip(getTooltipData);

  return (
    <div className="w-full">
      <Line
        style={{
          height: 400,
          display: "block",
        }}
        data={data}
        options={{
          layout: {
            autoPadding: true,
          },
          maintainAspectRatio: false,
          // responsive: true,
          // maintainAspectRatio: false, // This is important to stretch in height
          hover: {
            mode: "nearest",
            intersect: false,
          },
          plugins: {
            legend: {
              display: false,
            },
            // datalabels: {
            //   display: false,
            // },
            tooltip: {
              enabled: false,
              mode: "nearest",
              intersect: false,
              borderColor: theme.primary[700],
              borderWidth: 1,
              backgroundColor: theme.primary[800],
              padding: 16,
              displayColors: false,
              boxPadding: 8,
              caretSize: 10,
              animation: false,
              external,
            },
          },

          //All of these are important for making the axes look good
          scales: {
            //These options format the x axis
            x: {
              grid: {
                //The little legs at the bottom of the chart
                drawOnChartArea: false,
                lineWidth: 1,
                color: [theme.primary[800]],
              },
              //The labels and increments
              ticks: {
                color: [theme.primary[500]],
                // drawTicks: true,
                autoSkip: true,
                maxRotation: 0,
                maxTicksLimit: 5,
                padding: 4,
              },
            },
            //Y axis
            y: {
              stackWeight: 1,
              grid: {
                color: [theme.primary[800]],
              },
              ticks: {
                color: [theme.primary[500]],
                padding: 16,
                maxTicksLimit: 5,
                callback: yPercent
                  ? function (value) {
                      return `${value}%`; // Append a percentage sign to each label
                    }
                  : undefined,
              },
              border: {
                color: "transparent",
              },
            },
          },
          ...(disableAnimations
            ? {
                animation: false,
                animations: {
                  colors: false,
                  x: false,
                },
                transitions: {
                  active: {
                    animation: {
                      duration: 0,
                    },
                  },
                },
              }
            : {}),
        }}
        plugins={[
          {
            id: "verticalLine",
            beforeDatasetsDraw: (chart) => {
              const tooltip = chart.tooltip;
              if (tooltip && tooltip.getActiveElements().length > 0) {
                const ctx = chart.ctx;
                const x = tooltip.getActiveElements()[0].element.x;
                const topY = chart.scales.y.top;
                const bottomY = chart.scales.y.bottom;

                ctx.save();
                ctx.beginPath();
                ctx.moveTo(x, topY);
                ctx.lineTo(x, bottomY);
                ctx.lineWidth = 1;
                ctx.strokeStyle = theme.primary[800];
                ctx.stroke();
                ctx.restore();
              }
            },
          },
          // stripeTooltipPlugin,
        ]}
      />
      {tooltipNode}
    </div>
  );
};
