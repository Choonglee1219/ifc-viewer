import { IfcAPI, Handle, IFCGLOBALLYUNIQUEID, IFCLABEL, IFCBOOLEAN, FILE_NAME, IFCPROPERTYSET, IFCRELDEFINESBYPROPERTIES, IFCPROPERTYSINGLEVALUE } from "web-ifc/web-ifc-api";
import ifcwasm from "web-ifc/web-ifc.wasm?url"; // 경로 뒤에 "?url"을 붙이면 파일 주소 가상화 (WASM, JSON 만 허용)
import ifcmtwasm from "web-ifc/web-ifc-mt.wasm?url";
import { Group, BufferAttribute, BufferGeometry, Color, DoubleSide, Matrix4, Mesh, MeshMatcapMaterial, TextureLoader } from "three";
import * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils";
import matcapTexture from "../../assets/lightMatCap.png"; // 이미지나 텍스트 파일의 경우 자동으로 파일 주소 가상화함

import { v4 as uuid4 } from "uuid";
import { entityArguments } from "./arguments";
import { valueToIfcType } from "./type";
import { entityToJson, fileToUint8Array, fillEmptyCell, setValue } from "./utils";
import { getDataInMemory, memory, resetMemory, saveMemory } from "./memory";
import { mergeByMaterial } from "./geometry";

export class ifcLoader {
    static path = "IFC";
    static title = "Loader";
    static description = "IFCLoader";
    // "static" 으로 정의시 노드가 설치 될때 한번만 메모리에 등록 (최적화)
    static texture = new TextureLoader().load(matcapTexture);

    constructor() {
        // IFCjs 초기화
        this.ifcAPI = new IfcAPI();
        this.ifcAPI.SetWasmPath(ifcwasm, true);
        this.isLoadedModel = false;
        this.isReady = this.ifcAPI.Init(path => {
            // IFCjs 에서 주어진 주소가 아닌 가상화된 주소로 변경
            switch (path) {
                case "web-ifc.wasm":
                    return ifcwasm;
                default:
                    return ifcmtwasm;
            }
        });
        this.modelID = undefined;
        this.fileName = undefined;
        this.propetySets = [];

        this.addInput("ifc", "");
        this.addInput("export", -1);
        this.addInput("import", -1);

        this.addOutput("api", "");
        this.addOutput("meshes", "");
        this.addOutput("sheets", -1);
        this.addOutput("ifc", -1);
        this.addOutput("data", -1);
    }

    // IFCjs에서 나온 Mesh를 THREEjs Mesh로 변경
    #convertMesh(modelID, expressID, placedGeometries) {
        const size = placedGeometries.size();
        let geos = [];
        for (let i = 0; i < size; i++) {
            const placedGeometry = placedGeometries.get(i);
            //IFC모델에서 Geometry => vertices, indices 추출
            const ifcGeometry = this.ifcAPI.GetGeometry(modelID, placedGeometry.geometryExpressID);
            const ifcVertices = this.ifcAPI.GetVertexArray(ifcGeometry.GetVertexData(), ifcGeometry.GetVertexDataSize());
            const ifcIndices = this.ifcAPI.GetIndexArray(ifcGeometry.GetIndexData(), ifcGeometry.GetIndexDataSize());
            // 메모리 확보를 위해 이미 다 사용된 IFCjs Geometry 제거
            ifcGeometry.delete();

            // Vertices를 THREE BufferGeometry "position", "normal" attribute생성 및 적용
            const posFloats = new Float32Array(ifcVertices.length / 2);
            const normFloats = new Float32Array(ifcVertices.length / 2);
            const idAttribute = new Uint32Array(ifcVertices.length / 6);

            for (let i = 0; i < ifcVertices.length; i += 6) {
                posFloats[i / 2] = ifcVertices[i];
                posFloats[i / 2 + 1] = ifcVertices[i + 1];
                posFloats[i / 2 + 2] = ifcVertices[i + 2];

                normFloats[i / 2] = ifcVertices[i + 3];
                normFloats[i / 2 + 1] = ifcVertices[i + 4];
                normFloats[i / 2 + 2] = ifcVertices[i + 5];

                idAttribute[i / 6] = expressID;
            }
            const threeGeometry = new BufferGeometry();
            threeGeometry.setAttribute("position", new BufferAttribute(posFloats, 3));
            threeGeometry.setAttribute("normal", new BufferAttribute(normFloats, 3));
            threeGeometry.setAttribute("expressID", new BufferAttribute(idAttribute, 1));
            // indices 적용
            threeGeometry.setIndex(new BufferAttribute(ifcIndices, 1));
            // transform
            threeGeometry.applyMatrix4(new Matrix4().fromArray(placedGeometry.flatTransformation));
            threeGeometry.rotateX(Math.PI / 2);
            threeGeometry.computeBoundingBox();
            geos.push(threeGeometry);
        }

        const ifcColor = placedGeometries.get(0).color;
        const threeColor = new Color().setRGB(ifcColor.x, ifcColor.y, ifcColor.z, "srgb");
        const material = new MeshMatcapMaterial({
            name: `${ifcColor.x}${ifcColor.y}${ifcColor.z}${ifcColor.w}`,
            color: threeColor,
            side: DoubleSide,
            matcap: ifcLoader.texture,
            transparent: true,
            opacity: ifcColor.w,
        });
        const mGeo = BufferGeometryUtils.mergeGeometries(geos);
        const mesh = new Mesh(mGeo, material);
        mesh.matrixAutoUpdate = false;
        mesh.scale.x = 1;
        mesh.scale.y = 1;
        mesh.scale.z = 1;
        return mesh;
    }

    // // Mesh Stream 처리 Function
    #stream(modelID, ifcMesh, meshes) {
        const { expressID, geometries: placedGeometries } = ifcMesh;
        const mesh = this.#convertMesh(modelID, expressID, placedGeometries);
        meshes.push([expressID, mesh]);
    }

    async #getChildMesh(structure, meshes) {
        let { expressID: id, type, GlobalId: globalID, Name: name, Description: description, children } = entityToJson(structure);
        // let pSets = (await this.ifcAPI.properties.getPropertySets(this.modelID, id, true)).map(ps => entityToJson(ps));
        // this.propertySets.push([id, pSets]);
        let pSets = [];

        if (children.length > 0) {
            let childGroup = new Group();
            childGroup.ifc = { id, type, globalID, name, description, $propertySets: pSets };
            childGroup.ifcID = id;
            for (let c of children) {
                let grandChild = await this.#getChildMesh(c, meshes);
                if (grandChild) childGroup.add(grandChild);
            }
            // children.forEach(c => {
            //     let grandChild = this.#getChildMesh(c, meshes);
            //     if (grandChild) childGroup.add(this.#getChildMesh(c, meshes));
            // });
            if (childGroup.children.length > 0) return childGroup;
        } else {
            let idx = meshes.findIndex(e => e[0] === id);
            if (idx > -1) {
                meshes[idx][1].ifc = { id, type, globalID, name, description, $propertySets: pSets };
                meshes[idx][1].ifcID = id;
                return meshes[idx][1];
            }
        }
    }

    // IFC Load entrypoint function
    async #loadIFC(ifcBinary) {
        console.time("Loaded ifc");
        const modelID = this.ifcAPI.OpenModel(ifcBinary);
        this.modelID = modelID;
        this.isLoadedModel = true;
        // Read structures in ifc model
        console.time("Read structures: ");
        this.structure = await this.ifcAPI.properties.getSpatialStructure(modelID, true);
        console.log("Loaded structure", this.structure);
        console.timeEnd("Read structures: ");

        // Load mesh from ifc structures
        console.time("Loaded ifc: ");
        const _meshes = [];
        this.ifcAPI.StreamAllMeshes(modelID, ifcMesh => {
            // only during the lifetime of this function call, the geometry is available in memory
            this.#stream(modelID, ifcMesh, _meshes);
        });

        let project = entityToJson(this.ifcAPI.GetLine(modelID, this.structure.expressID, true));
        let group = new Group();
        group.ifc = { id: project.expressID, type: "IFCPROJECT", globalID: project.GlobalId, name: project.Name };
        group.ifcID = project.expressID;
        for (let s of this.structure.children) {
            let child = await this.#getChildMesh(s, _meshes);
            if (child) group.add(child);
        }
        // this.structure.children.forEach(s => {
        //     let child = this.#getChildMesh(s, _meshes);
        //     if (child) group.add(child);
        // });
        console.timeEnd("Loaded ifc: ");
        return { modelID, meshStore: [group] };
    }

    #getPropChildren(schema, property, targetInfo, isComplex = false) {
        let node = this;
        const { ifcAPI } = this;
        const ifcArgMap = entityArguments[schema];
        let { columnArgs, elementName, pSetID, pSetType, pSetNameValue, row, ri } = targetInfo;
        let p = entityToJson(property);
        let { Name, expressID, type } = p;
        if (type === 3021840470) {
            // IfcPhysicalComplexQuantity
            p.HasQuantities.forEach(e => {
                let newTargetInfo = { columnArgs, elementName, pSetID: p.expressID, pSetType: type, pSetNameValue: p.Name, row, ri };
                node.#getPropChildren(schema, e, newTargetInfo, true);
            });
        } else {
            let propTypeName = ifcAPI.GetNameFromTypeCode(type).toLowerCase().replace("ifc", "");
            let valueName = ifcArgMap[propTypeName][2];
            if (valueName === "Unit") valueName = ifcArgMap[propTypeName][3];
            let name = isComplex ? `[${pSetNameValue}]${Name}` : Name;
            let ci = columnArgs.findIndex(e => e.value === name);

            if (ci < 0) {
                columnArgs.push({
                    style: {
                        bold: true,
                        italic: true,
                        fill: {
                            type: "solid",
                            color: { rgb: "00c800" }, // green
                        },
                        horizontalAlignment: "center",
                        border: true,
                    },
                    value: name,
                });
                ci = columnArgs.length - 1;
            }
            let value = p[valueName];

            if (value === "") value = undefined;
            if (Array.isArray(value)) {
                value = String(p[valueName]);
            }

            row[ci] = { style: { horizontalAlignment: "center", border: true }, value: value };
            saveMemory(elementName, { pSetID, pSetType, expressID, typeName: propTypeName, typeID: type, value, name: Name }, ri, ci);
        }
    }

    async #getSheets() {
        let node = this;
        const { modelID, ifcAPI } = this;
        const schema = ifcAPI.GetModelSchema(modelID);
        const ifcArgMap = entityArguments[schema];

        let sheets = [];
        async function recursiveElement(element) {
            let elementName = element.type.toLowerCase().replace("ifc", "");
            let argNames = ifcArgMap[elementName];
            let isExistType = argNames ? true : false;
            if (isExistType) {
                let originColumnArgs = ["expressID", "type", ...argNames];
                let columnArgs;
                let sheetIdx = sheets.findIndex(e => e.name === elementName);
                if (sheetIdx >= 0) {
                    columnArgs = sheets[sheetIdx].data[0];
                    // columnArgs = sheets[sheetIdx].data[0].map(e => e.value);
                } else {
                    columnArgs = ["expressID", "type", ...argNames].map(e => {
                        return {
                            style: {
                                bold: true,
                                fill: {
                                    type: "solid",
                                    color: { rgb: "c8c800" }, // yellow
                                },
                                horizontalAlignment: "center",
                                border: true,
                            },
                            value: e,
                        };
                    });
                    sheets.push({
                        name: elementName,
                        data: [columnArgs],
                    });
                    sheetIdx = sheets.findIndex(e => e.name === elementName);
                }
                let sheet = sheets[sheetIdx];
                let row = columnArgs.map(c => {
                    let value = element[c.value] ?? undefined;
                    if (Array.isArray(value)) value = String(value);
                    return { style: { horizontalAlignment: "center", border: true }, value: value };
                });
                let ri = sheet.data.length;

                let pSets = await ifcAPI.properties.getPropertySets(modelID, element.expressID, true);
                pSets.forEach(pSet => {
                    if (pSet) {
                        let pSetID = pSet.expressID;
                        let childName = pSet.HasProperties ? "HasProperties" : "Quantities";
                        let parent = pSet[childName];
                        parent.forEach(prop => {
                            // if (!prop) console.log();
                            if (prop) {
                                let targetInfo = { columnArgs, elementName, pSetID, pSetType: pSet.type, pSetNameValue: pSet.Name.value, row, ri };
                                node.#getPropChildren(schema, prop, targetInfo);
                            }
                        });
                    }
                });
                sheet.data.push(row);
                let children = [];
                for (let c of element.children) {
                    let child = await recursiveElement(entityToJson(c));
                    children.push(child);
                }
                element.children = children;
                return element;
            }
        }
        await recursiveElement(entityToJson(this.structure));
        return sheets;
    }

    #editPropertiesBySheets(sheets) {
        let node = this;
        const { modelID, ifcAPI } = this;
        const schema = ifcAPI.GetModelSchema(modelID);
        const ohIDs = ifcAPI.GetLineIDsWithType(modelID, 1207048766);
        let ownerHistoryID = undefined;
        if (ohIDs.size() > 0) ownerHistoryID = ohIDs.get(0);
        const ifcArgMap = entityArguments[schema];
        const filtered = sheets.filter(s => {
            let entityName = s.name;
            let column = s.data[0];
            let argNames = entityArguments[schema][entityName];
            return column.length - 2 !== argNames.length;
        });

        filtered.forEach((s, i) => {
            let elementName = s.name;
            let column = s.data[0];
            let argNames = entityArguments[schema][elementName];
            let sci = argNames.length + 2;
            s.data.forEach((row, ri) => {
                if (ri !== 0 && row[0]) {
                    let elementID = Number(row[0]);
                    // edit & create IfcPropertyEntity
                    let newProps = [];
                    for (let ci = sci; ci < column.length; ci++) {
                        let cellValue = row[ci];
                        let m = getDataInMemory(elementName, ri, ci);
                        if (m !== false) {
                            let valueName = ifcArgMap[m.typeName][2];
                            if (valueName === "Unit") valueName = ifcArgMap[m.typeName][3];
                            if (setValue(m.value) !== setValue(cellValue)) {
                                let prop = ifcAPI.GetLine(modelID, m.expressID);
                                let name = ifcAPI.CreateIfcType(modelID, IFCLABEL, m.name);
                                let value = valueToIfcType(ifcAPI, modelID, valueName, row[ci]);
                                prop[valueName] = value;
                                prop.Name = name;
                                ifcAPI.WriteLine(modelID, prop);
                            }
                        } else {
                            if (![undefined, null, ""].includes(cellValue)) {
                                let propID = ifcAPI.GetMaxExpressID(modelID) + 1;
                                let value = valueToIfcType(ifcAPI, modelID, "NominalValue", row[ci]);
                                let propArgs = [ifcAPI.CreateIfcType(modelID, IFCLABEL, column[ci]), null, value, null];
                                let prop = ifcAPI.CreateIfcEntity(modelID, IFCPROPERTYSINGLEVALUE, ...propArgs);
                                prop.expressID = propID;
                                // console.log(elementID, m, prop.Name, prop);
                                if (typeof cellValue === "string" && cellValue.includes("0-461-L-CC130")) console.log("here", prop);
                                newProps.push(prop);
                                ifcAPI.WriteLine(modelID, prop);
                            }
                        }
                    }

                    if (newProps.length > 0) {
                        let pSetID = ifcAPI.GetMaxExpressID(modelID) + 1;
                        let relID = pSetID + 1;
                        // create IfcPropertySet
                        ifcAPI.CreateIfcType(modelID, IFCLABEL, "pSet_AddedByUser");
                        let pSetArgs = [
                            ifcAPI.CreateIfcType(modelID, IFCGLOBALLYUNIQUEID, uuid4()),
                            new Handle(ownerHistoryID),
                            ifcAPI.CreateIfcType(modelID, IFCLABEL, "pSet_AddedByUser"),
                            null,
                            newProps.map(e => new Handle(e.expressID)),
                        ];
                        let pSet = ifcAPI.CreateIfcEntity(modelID, IFCPROPERTYSET, ...pSetArgs);
                        pSet.expressID = pSetID;
                        ifcAPI.WriteLine(modelID, pSet);
                        // create IfcRelDefinesByProperties
                        let relArgs = [
                            ifcAPI.CreateIfcType(modelID, IFCGLOBALLYUNIQUEID, uuid4()),
                            new Handle(ownerHistoryID),
                            null,
                            null,
                            [new Handle(elementID)],
                            new Handle(pSetID),
                        ];
                        let rel = ifcAPI.CreateIfcEntity(modelID, IFCRELDEFINESBYPROPERTIES, ...relArgs);
                        rel.expressID = relID;
                        ifcAPI.WriteLine(modelID, rel);
                        // set properties
                        ifcAPI.properties.setPropertySets(modelID, elementID, pSetID);
                    }
                }
            });
        });
    }

    async onExecute() {
        // set output slot data 'Hello'
        if (this.getInputData(0)) {
            await this.isReady;

            // reset structure & memory
            resetMemory();
            this.structure = {};

            const file = this.getInputData(0);
            const extension = file.path.match(/\.[^.]+$/)[0];
            if (extension.toLowerCase() !== ".ifc") throw new Error("Not the ifc file.");
            this.fileName = file.path.replace(extension, "");
            const ifc = await fileToUint8Array(file);
            const { meshStore } = await this.#loadIFC(ifc);
            this.setOutputData(0, this.ifcAPI);
            this.setOutputData(1, meshStore);
        }
    }

    async onAction(evt, data) {
        if (this.modelID !== undefined) {
            switch (evt) {
                case "export":
                    resetMemory();
                    console.time("new call elements: ");
                    let initSheets = await this.#getSheets();
                    console.timeEnd("new call elements: ");
                    const sheets = fillEmptyCell(this.ifcAPI.GetModelSchema(this.modelID), memory, initSheets);
                    const sheetsWithoutStyle = sheets.map(s => {
                        let data = s.data.map(r => {
                            let row = r.map(cell => cell.value ?? undefined);
                            return row;
                        });
                        return { name: s.name, data };
                    });
                    this.triggerSlot(2, { name: `${this.fileName}-proeprties.xlsx`, file: sheetsWithoutStyle });
                    break;
                case "import":
                    if (memory.length > 0) {
                        console.time("Create ifc with edited properties");
                        this.#editPropertiesBySheets(data ?? []);
                        console.timeEnd("Create ifc with edited properties");
                        // Applying integer 1 to IfcOwnerHistory to fix exponentail err
                        let ohIds = this.ifcAPI.GetLineIDsWithType(this.modelID, 1207048766);
                        let oh = this.ifcAPI.GetLine(this.modelID, ohIds.get(0));
                        if (oh.LastModifiedDate) oh.LastModifiedDate.value = 1;
                        if (oh.CreationDate) oh.CreationDate.value = 1;
                        this.ifcAPI.WriteLine(this.modelID, oh);
                        let ifc = this.ifcAPI.SaveModel(this.modelID);
                        this.triggerSlot(3, { name: `${this.fileName.replace(".ifc", "")}-edited.ifc`, file: ifc });
                    } else {
                        throw new Error("Must export property file first");
                    }
                    break;
                default:
                    break;
            }
        } else {
            throw new Error("Must upload ifc file first.");
        }
    }
}
