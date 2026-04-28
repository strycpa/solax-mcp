export type RegisterType = "input" | "holding";
export type RegisterDataType = "u16" | "s16" | "u32" | "s32" | "s32-swap";

export interface RegisterDefinition {
  key: string;
  name: string;
  description: string;
  address: number;
  registerType: RegisterType;
  dataType: RegisterDataType;
  unit?: string;
  scale?: number;
  precision?: number;
}

function defineRegisters<const T extends readonly RegisterDefinition[]>(
  registers: T,
): T {
  return registers;
}

// Default map targets SolaX Hybrid G4 10k and follows the hybrid GEN4 entities from
// wills106/homeassistant-solax-modbus/custom_components/solax_modbus/plugin_solax.py.
export const SOLAX_DEFAULT_REGISTER_MAP = defineRegisters([
  {
    key: "inverter_voltage",
    name: "Inverter Voltage",
    description: "Inverter AC voltage.",
    address: 0x00,
    registerType: "input",
    dataType: "u16",
    unit: "V",
    scale: 0.1,
    precision: 1,
  },
  {
    key: "inverter_power",
    name: "Inverter Power",
    description: "Current inverter output power.",
    address: 0x02,
    registerType: "input",
    dataType: "s16",
    unit: "W",
  },
  {
    key: "inverter_frequency",
    name: "Inverter Frequency",
    description: "Inverter AC frequency.",
    address: 0x07,
    registerType: "input",
    dataType: "u16",
    unit: "Hz",
    scale: 0.01,
    precision: 2,
  },
  {
    key: "inverter_temperature",
    name: "Inverter Temperature",
    description: "Inverter temperature.",
    address: 0x08,
    registerType: "input",
    dataType: "s16",
    unit: "C",
  },
  {
    key: "pv_power_1",
    name: "PV Power 1",
    description: "Power from the first PV string.",
    address: 0x0a,
    registerType: "input",
    dataType: "u16",
    unit: "W",
  },
  {
    key: "pv_power_2",
    name: "PV Power 2",
    description: "Power from the second PV string.",
    address: 0x0b,
    registerType: "input",
    dataType: "u16",
    unit: "W",
  },
  {
    key: "battery_voltage_charge",
    name: "Battery Voltage Charge",
    description: "Battery voltage.",
    address: 0x14,
    registerType: "input",
    dataType: "s16",
    unit: "V",
    scale: 0.1,
    precision: 1,
  },
  {
    key: "battery_current_charge",
    name: "Battery Current Charge",
    description: "Battery current.",
    address: 0x15,
    registerType: "input",
    dataType: "s16",
    unit: "A",
    scale: 0.1,
    precision: 1,
  },
  {
    key: "battery_power_charge",
    name: "Battery Power Charge",
    description: "Battery power. Positive values mean charging in the Home Assistant mapping.",
    address: 0x16,
    registerType: "input",
    dataType: "s16",
    unit: "W",
  },
  {
    key: "battery_capacity",
    name: "Battery Capacity",
    description: "Current battery state of charge.",
    address: 0x1c,
    registerType: "input",
    dataType: "u16",
    unit: "%",
  },
  {
    key: "measured_power",
    name: "Measured Power",
    description: "Grid meter power. Positive values are treated as export, negative values as import.",
    address: 0x46,
    registerType: "input",
    dataType: "s32-swap",
    unit: "W",
  },
]);

export type SolaxFieldKey = (typeof SOLAX_DEFAULT_REGISTER_MAP)[number]["key"];

export function getRegisterDefinition(
  key: SolaxFieldKey,
): RegisterDefinition {
  const definition = SOLAX_DEFAULT_REGISTER_MAP.find(
    (register) => register.key === key,
  );

  if (definition === undefined) {
    throw new Error(`Unknown SolaX field: ${key}`);
  }

  return definition;
}
