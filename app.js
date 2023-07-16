import { Color, LineBasicMaterial, MeshBasicMaterial } from 'three';
import { IfcViewerAPI } from 'web-ifc-viewer';


const container = document.getElementById('viewer-container');
const viewer = new IfcViewerAPI({
  container,
  backgroundColor: new Color(0x16213e)
});

// Create grid, axes, clipper, dimensions
// viewer.grid.setGrid();
viewer.axes.setAxes();
viewer.clipper.active = true;
viewer.dimensions.active = true;
viewer.dimensions.previewActive = true;


let ifcModel;  // global variable

init();


async function init() {
  await viewer.IFC.setWasmPath("./")
  
  // Load the model without user input
  ifcModel = await viewer.IFC.loadIfcUrl('./ifc_files/aveva_230224.ifc');
  
  // Load th model with user input
  const loadButton = document.getElementById("load-button");
  const input = document.getElementById("file-input");
  loadButton.onclick = () => {
    input.click();
  };
  input.addEventListener("change", (event) => {
    const file = event.target.files[0];
    const url = URL.createObjectURL(file);
    viewer.IFC.loadIfcUrl(url);
  });
  
  
  // TreeMenu
  const ifcProject = await viewer.IFC.getSpatialStructure(ifcModel.modelID);
  createTreeMenu(ifcProject);
  
  //visibility-single
  const allIDs = getAllIds(ifcModel);
  const subset = getWholeSubset(viewer, ifcModel, allIDs);
  replaceOriginalModelBySubset(viewer, ifcModel, subset);
  setupEvents(viewer, allIDs);

  // Floor Plans
  await viewer.plans.computeAllPlanViews(ifcModel.modelID);

  const lineMaterial = new LineBasicMaterial({ color: 'black' });
  const baseMaterial = new MeshBasicMaterial({
    polygonOffset: true,
    polygonOffsetFactor: 1, // positive value pushes polygon further away
    polygonOffsetUnits: 1,
  });

  await viewer.edges.create('example-edges', ifcModel.modelID, lineMaterial, baseMaterial);

  const allPlans = viewer.plans.getAll(ifcModel.modelID);

  const buttonContainer = document.getElementById('button-container');

  for (const plan of allPlans) {
    const currentPlan = viewer.plans.planLists[ifcModel.modelID][plan];

    const btn = document.createElement('button');
    btn.style.color = '#ffffff';
    btn.style.backgroundColor = 'black';
    buttonContainer.appendChild(btn);
    btn.textContent = currentPlan.name;
    btn.onclick = () => {
      viewer.plans.goTo(ifcModel.modelID, plan);
      viewer.edges.toggle('example-edges', true);
      togglePostproduction(false);
      toggleShadow(false);
      console.log(currentPlan);
    };
  };
  
  const btn = document.createElement('button');
  btn.style.color = '#ffffff';
  btn.style.backgroundColor = 'black';
  buttonContainer.appendChild(btn);
  btn.textContent = 'Exit Plan';
  btn.onclick = () => {
    viewer.plans.exitPlanView();
    viewer.edges.toggle('example-edges', false);
    togglePostproduction(true);
    toggleShadow(true);
  };
  
};

function toggleShadow(active) {
  const shadows = Object.values(viewer.shadowDropper.shadows);
  for (shadow of shadows) {
    shadow.root.visible = active;
  }
}

function togglePostproduction(active) {
  viewer.context.renderer.postProduction.active = active;
}

// Select element
window.ondblclick = async (event) => {
  if (dimensionsActive || clippingPlanesActive) {
    return;
  }
  if (!propertiesMenuActive) {
    propertiesButton.click()
  }
  const result1 = await viewer.IFC.selector.pickIfcItem();
  if (!result1) return;
  if (event.ctrlKey) viewer.IFC.selector.highlightIfcItem();
  const { modelID, id } = result1;
  const props = await viewer.IFC.getProperties(modelID, id, true, false);
  const psets = await viewer.IFC.loader.ifcManager.getPropertySets(modelID, id, true, false)[1];
  console.log(props);
  console.log(psets);
  createPropertiesMenu(props);
};


// Properties menu
const propertiesMenu = document.getElementById("ifc-property-menu");
const treeMenu = document.getElementById("ifc-tree-menu");
let propertiesMenuActive = false;
const propsGUI = document.getElementById("ifc-property-menu-root");
const propertiesButton = document.getElementById("properties-button");
propertiesButton.onclick = () => {
  propertiesMenuActive = !propertiesMenuActive
  propertiesButton.classList.toggle("button-active");
  propertiesMenu.classList.toggle("hidden");
};

function createPropertiesMenu(properties) {
  removeAllChildren(propsGUI);

  const psets = properties.psets;
  const mats = properties.mats;
  const type = properties.type;

  console.log(psets);
  console.log(mats);
  console.log(type);

  delete properties.psets;
  delete properties.mats;
  delete properties.type;


  for (let key in properties) {
    createPropertyEntry(key, properties[key]);
  }
}

function createPropertyEntry(key, value) {
  const propContainer = document.createElement("div");
  propContainer.classList.add("ifc-property-item");

  if (value === null || value === undefined) value = "undefined";
  else if (value.value) value = value.value;

  const keyElement = document.createElement("div");
  keyElement.textContent = key;
  propContainer.appendChild(keyElement);

  const valueElement = document.createElement("div");
  valueElement.classList.add("ifc-property-value");
  valueElement.textContent = value;
  propContainer.appendChild(valueElement);

  propsGUI.appendChild(propContainer);
}


//Clipping planes
let clippingPlanesActive = false;

const clipperButton = document.getElementById("clip-button");

clipperButton.onclick = () => {
   if (dimensionsActive) {
      measureButton.click();
   }
   clippingPlanesActive = !clippingPlanesActive;
   viewer.clipper.active = clippingPlanesActive;
   clipperButton.classList.toggle("button-active");
};

window.addEventListener("click", (event) => {
   if (clippingPlanesActive && event.ctrlKey) viewer.clipper.createPlane();
   viewer.context.renderer.postProduction.update();
});

window.addEventListener("keydown", (event) => {
   if (event.code === "Delete" && clippingPlanesActive)
      viewer.clipper.deletePlane();
});


//Dimensions measurements
let dimensionsActive = false;
let dimensionsPreviewActive = false;

const measureButton = document.getElementById("measure-button");

measureButton.onclick = () => {
   if (clippingPlanesActive) {
      clipperButton.click();
   }
   dimensionsActive = !dimensionsActive;
   dimensionsPreviewActive = !dimensionsPreviewActive;

   viewer.dimensions.active = dimensionsActive;
   viewer.dimensions.previewActive = dimensionsPreviewActive;
   measureButton.classList.toggle("button-active");
};

window.addEventListener("click", (event) => {
   if (dimensionsActive && event.ctrlKey) viewer.dimensions.create();
});

window.addEventListener("keydown", (event) => {
   if (event.code === "Delete" && dimensionsActive) viewer.dimensions.delete();
   viewer.context.renderer.postProduction.update();
});


//Clearing picked or highlighted items
const clearButton = document.getElementById("clear-button");

clearButton.onclick = () => {
  viewer.IFC.selector.unHighlightIfcItems();
  viewer.IFC.selector.unpickIfcItems();
  removeAllChildren(propsGUI);
  togglePostproduction(true);
  toggleShadow(true);
};


//Visibility-single
function setupEvents(viewer, allIDs) {
	let hideElementActive = false;
  
  const hideButton = document.getElementById("hide-button");

  hideButton.onclick = () => {
    hideElementActive = !hideElementActive;
    hideButton.classList.toggle("button-active");
  };

  window.addEventListener("click", (event) => {
    if (hideElementActive && event.ctrlKey) hideClickedItem(viewer);
	});

  window.onkeydown = (event) => {
    if (event.code === 'Escape' && hideElementActive) {
      showAllItems(viewer, allIDs);
    }
  };
};

function getAllIds(ifcModel) {
	return Array.from(
		new Set(ifcModel.geometry.attributes.expressID.array),
	);
}

function replaceOriginalModelBySubset(viewer, ifcModel, subset) {
	const items = viewer.context.items;

	items.pickableIfcModels = items.pickableIfcModels.filter(model => model !== ifcModel);
	items.ifcModels = items.ifcModels.filter(model => model !== ifcModel);
	ifcModel.removeFromParent();

	items.ifcModels.push(subset);
	items.pickableIfcModels.push(subset);
}

function getWholeSubset(viewer, ifcModel, allIDs) {
	return viewer.IFC.loader.ifcManager.createSubset({
		modelID: ifcModel.modelID,
		ids: allIDs,
		applyBVH: true,
		scene: ifcModel.parent,
		removePrevious: true,
		customID: 'full-model-subset',
	});
}

function showAllItems(viewer, ids) {
	viewer.IFC.loader.ifcManager.createSubset({
		modelID: 0,
		ids,
		removePrevious: false,
		applyBVH: true,
		customID: 'full-model-subset',
	});
}

function hideClickedItem(viewer) {
	const result = viewer.context.castRayIfc();
	if (!result) return;
	const manager = viewer.IFC.loader.ifcManager;
	const id = manager.getExpressId(result.object.geometry, result.faceIndex);
	viewer.IFC.loader.ifcManager.removeFromSubset(
		0,
		[id],
		'full-model-subset',
	);
}


//Spatial tree
const treeButton = document.getElementById("tree-button");
treeButton.onclick = () => {
   treeButton.classList.toggle("button-active");
   treeMenu.classList.toggle("hidden");
};

// Tree menu
const toggler = document.getElementsByClassName("caret");
for (let i = 0; i < toggler.length; i++) {
  toggler[i].onclick = () => {
    toggler[i].parentElement.querySelector(".nested").classList.toggle("active");
    toggler[i].classList.toggle("caret-down");
  }
}

function createTreeMenu(ifcProject) {
  const root = document.getElementById("tree-root");
  removeAllChildren(root);
  const ifcProjectNode = createNestedChild(root, ifcProject);
  ifcProject.children.forEach(child => {
    constructTreeMenuNode(ifcProjectNode, child);
  })
}

function nodeToString(node) {
  return `${node.type} - ${node.expressID}`
}

function constructTreeMenuNode(parent, node) {
  const children = node.children;
  if (children.length === 0) {
    createSimpleChild(parent, node);
    return;
  }
  const nodeElement = createNestedChild(parent, node);
  children.forEach(child => {
    constructTreeMenuNode(nodeElement, child);
  })
}

function createNestedChild(parent, node) {
  const content = nodeToString(node);
  const root = document.createElement('li');
  createTitle(root, content);
  const childrenContainer = document.createElement('ul');
  childrenContainer.classList.add("nested");
  root.appendChild(childrenContainer);
  parent.appendChild(root);
  return childrenContainer;
}

function createTitle(parent, content) {
  const title = document.createElement("span");
  title.classList.add("caret");
  title.onclick = () => {
    title.parentElement.querySelector(".nested").classList.toggle("active");
    title.classList.toggle("caret-down");
  }
  title.textContent = content;
  parent.appendChild(title);
}

function createSimpleChild(parent, node) {
  const content = nodeToString(node);
  const childNode = document.createElement('li');
  childNode.classList.add('leaf-node');
  childNode.textContent = content;
  parent.appendChild(childNode);

  childNode.onmouseover = () => {
    viewer.IFC.selector.prepickIfcItemsByID(ifcModel.modelID, [node.expressID]);
  }

  childNode.onclick = async () => {
    await viewer.IFC.selector.pickIfcItemsByID(ifcModel.modelID, [node.expressID], true, true);
    removeAllChildren(propsGUI);
    await viewer.IFC.selector.pickIfcItemsByID(ifcModel.modelID, [node.expressID], true, true);
	  if (!propertiesMenuActive) {
		  propertiesButton.click();
	  }
	  const props2 = await viewer.IFC.getProperties(ifcModel.modelID, [node.expressID][0], true, false);
	  createPropertiesMenu(props2);
  }

  childNode.onmouseout = async () => {
    await viewer.IFC.selector.unPrepickIfcItems();
  }
}

function removeAllChildren(element) {
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
}
