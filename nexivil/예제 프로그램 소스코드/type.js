import { Handle } from "web-ifc";
import { IFCTEXT, IFCBOOLEAN, IFCREAL } from "web-ifc/web-ifc-api";

export function valueToIfcType(ifcAPI, modelID, propertyName, value) {
    const ifcType = {
        GlobalId: () => ifcAPI.CreateIfcType(modelID, ifcAPI.GetTypeCodeFromName("IFCGLOBALLYUNIQUEID"), value),
        OwnerHistory: () => new Handle(value),
        Name: () => ifcAPI.CreateIfcType(modelID, ifcAPI.GetTypeCodeFromName("IFCLABEL"), value),
        Description: () => ifcAPI.CreateIfcType(modelID, ifcAPI.GetTypeCodeFromName("IFCTEXT"), value),
        HasProperties: () => getHandles(propertyName, value),
        RelatedObjects: () => getHandles(propertyName, value),
        RelatingPropertyDefinition: () => new Handle(Number(value)),
        ListValues: () => {
            return value.split(",").map(e => valueToIfcType(ifcAPI, modelID, "value", e));
        },
    };
    const propNames = Object.keys(ifcType);

    if ([null, undefined].includes(value) || value === "") return null;
    if (propNames.includes(propertyName)) {
        return ifcType[propertyName]();
    } else {
        if (Array.isArray(value)) {
            return value.map(v => new Handle(v));
        } else if (isNaN(Number(value))) {
            return ifcAPI.CreateIfcType(modelID, IFCTEXT, value);
        } else {
            if (["true", "false"].includes(String(value).toLowerCase())) {
                let bool = String(value).toLowerCase() === "true" ? "T" : "F";
                return ifcAPI.CreateIfcType(modelID, IFCBOOLEAN, bool);
            }
            return ifcAPI.CreateIfcType(modelID, IFCREAL, value);
        }
    }
}

function getHandles(propertyName, value) {
    if (typeof value === "string") {
        return value.split("/").map(e => new Handle(Number(e)));
    } else if (typeof value === "number") {
        return [new Handle(value)];
    } else if (Array.isArray(value)) {
        return value.map(e => new Handle(e));
    } else {
        throw new Error(`${propertyName} is not valid value.`);
    }
}
