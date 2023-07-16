import { entityArguments } from "./arguments";
import { getDataInMemory } from "./memory";

export function getRawArguments(rawLineData, typeName) {
    let result = [rawLineData.ID, typeName];
    rawLineData.arguments.forEach(arg => {
        let isNull = arg === null;
        let isObject = typeof arg === "object";
        if (isNull) {
            result.push(null);
        } else {
            if (Array.isArray(arg)) {
                let arrStr = String(arg.map(e => e.value));
                let slashArr = arrStr.split(",").join("/");
                result.push(slashArr);
            } else if (isObject) {
                result.push(arg.value);
            } else {
                result.push(arg);
            }
        }
    });
    return result;
}

export function entityToJson(entity) {
    let obj = {};
    if (entity.value !== undefined && entity.type !== undefined) {
        return entity.value;
    }
    for (let propName in entity) {
        let prop = entity[propName];
        if (prop) {
            if (typeof prop.type !== "string" && prop.value !== undefined) {
                switch (prop.type) {
                    case 1:
                        obj[propName] = String(prop.value);
                        break;
                    case 3:
                        obj[propName] = prop.value.toUpperCase() === "T" ? true : false;
                        break;
                    case 4:
                        obj[propName] = Number(prop.value);
                        break;
                    default:
                        obj[propName] = prop.value;
                        break;
                }
            } else if (Array.isArray(prop)) {
                obj[propName] = prop.map(e => entityToJson(e));
            } else if (prop.expressID) {
                obj[propName] = prop.expressID;
            } else {
                obj[propName] = prop;
            }
        } else {
            obj[propName] = prop;
        }
    }
    return obj;
}

export function setValue(v) {
    if (v === undefined) {
        return v;
    } else if (isNaN(Number(v))) {
        if (["true", "false"].includes(String(v).toLowerCase())) {
            return String(v).toLowerCase() === "true" ? true : false;
        } else {
            return String(v);
        }
    } else {
        return Number(v);
    }
}

export async function fileToUint8Array(file) {
    const arrayBuffer = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(file);
    });
    return new Uint8Array(arrayBuffer);
}

export function fillEmptyCell(schema, memory, sheets) {
    const emptyCell = {
        style: {
            horizontalAlignment: "center",
            border: true,
            fill: {
                type: "solid",
                color: { rgb: "c8c8c8" }, // gray
            },
        },
        value: undefined,
    };
    const ifcArgMap = entityArguments[schema];
    sheets.forEach(sheet => {
        let numColumn = sheet.data[0].length;
        let argNames = ifcArgMap[sheet.name];
        let sci = argNames.length + 2;
        for (let ri = 1; ri < sheet.data.length; ri++) {
            let row = sheet.data[ri];
            for (let ci = sci; ci < numColumn; ci++) {
                let m = getDataInMemory(sheet.name, ri, ci);
                if (m === false) {
                    row[ci] = emptyCell;
                }
                if (ci >= row.length) {
                    row.push(emptyCell);
                }
            }

            if (row.length < numColumn) {
                let numEmptyCells = numColumn - row.length;
                if (numEmptyCells < 0) throw new Error(`what's worng: ${numColumn}, ${row.length}`);
                for (let j = 0; j < numEmptyCells; j++) {
                    row.push(emptyCell);
                }
            }
        }
    });
    return sheets;
}
